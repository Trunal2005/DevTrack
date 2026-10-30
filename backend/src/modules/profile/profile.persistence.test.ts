import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { Server } from 'node:http';
import { User, UserProfile } from '../../db/models/index.js';
import profileRoutes from './profile.routes.js';
import { updateProfile } from './profile.service.js';

const actor=vi.hoisted(()=>({id:''}));
vi.mock('../../middleware/index.js',async original=>{
  const actual=await original<typeof import('../../middleware/index.js')>();
  return {...actual,authMiddleware:(req:Request,res:Response,next:NextFunction)=>{
    if(!actor.id){res.status(401).json({success:false});return;}
    Object.assign(req,{user:{id:actor.id}});next();
  }};
});

let server:Server, base:string;
beforeAll(async()=>{
  const app=express(); app.use(express.json()); app.use('/api/v1/profile',profileRoutes);
  app.use((error:{statusCode?:number;status?:number},_req:Request,res:Response,_next:NextFunction)=>{res.status(error.statusCode||error.status||500).json({success:false});});
  server=await new Promise<Server>(resolve=>{const listening=app.listen(0,'127.0.0.1',()=>resolve(listening));});
  const address=server.address();if(!address||typeof address==='string')throw new Error('Missing test server port');
  base=`http://127.0.0.1:${address.port}/api/v1/profile`;
});
afterAll(async()=>{if(server)await new Promise<void>((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();});});
beforeEach(async()=>{
  const user=await User.create({clerkId:'synthetic-profile',email:'profile@example.test',username:'profiletester',displayName:'Synthetic contributor'});
  actor.id=user._id.toString();
});
const patch=(body:unknown)=>fetch(base,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const read=async()=>{const res=await fetch(base);expect(res.status).toBe(200);return (await res.json()).data;};

describe('profile HTTP/database persistence',()=>{
  it('normalizes tags for direct service callers as well as HTTP writes',async()=>{
    const result=await updateProfile(actor.id,{location:' New city ',techStack:[' React ','React',' ','Node']});
    expect(result).toMatchObject({location:'New city',techStack:['React','Node']});
    expect(await read()).toMatchObject({location:'New city',techStack:['React','Node']});
  });

  it('persists location and added/removed tags through PATCH and GET',async()=>{
    await UserProfile.create({userId:actor.id,techStack:['React','Node']});
    const res=await patch({location:' Hyderabad ',techStack:[' TypeScript ','Node','TypeScript']});
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({location:'Hyderabad',techStack:['TypeScript','Node']});
    expect(await read()).toMatchObject({location:'Hyderabad',techStack:['TypeScript','Node']});
    expect(await UserProfile.findOne({userId:actor.id}).lean()).toMatchObject({location:'Hyderabad',techStack:['TypeScript','Node']});
  });

  it('creates missing profile fields and clears them explicitly',async()=>{
    expect(await UserProfile.countDocuments({userId:actor.id})).toBe(0);
    expect((await read()).location).toBeNull();
    expect((await patch({location:'New city',techStack:['React']})).status).toBe(200);
    expect((await patch({location:'',techStack:[]})).status).toBe(200);
    expect(await read()).toMatchObject({location:null,techStack:[]});
    expect((await patch({location:null})).status).toBe(200);
  });

  it('keeps location and tags when unrelated fields are patched',async()=>{
    await patch({location:'Existing city',techStack:['React']});
    expect((await patch({bio:'Updated bio'})).status).toBe(200);
    expect(await read()).toMatchObject({location:'Existing city',techStack:['React'],bio:'Updated bio'});
  });

  it.each([{location:123},{location:'x'.repeat(101)},{techStack:'React'},{techStack:[123]},{techStack:['   ']}])('rejects invalid new-field input %# without persisting it',async payload=>{
    const res=await patch(payload);expect(res.status).toBe(400);
    expect(await UserProfile.countDocuments({userId:actor.id})).toBe(0);
  });

  it('preserves legacy tag endpoints and isolates another user',async()=>{
    const other=await User.create({clerkId:'synthetic-other',email:'other@example.test',username:'otherprofile',displayName:'Other contributor'});
    await UserProfile.create({userId:other._id,techStack:['Private tag']});
    expect((await patch({location:'Current city',techStack:['React']})).status).toBe(200);
    expect((await fetch(`${base}/tech-stack`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag:'Node'})})).status).toBe(200);
    expect((await fetch(`${base}/tech-stack/React`,{method:'DELETE'})).status).toBe(200);
    expect(await read()).toMatchObject({location:'Current city',techStack:['Node']});
    expect(await UserProfile.findOne({userId:other._id}).lean()).toMatchObject({techStack:['Private tag']});
  });

  it('requires authentication before accepting profile writes',async()=>{
    actor.id='';expect((await patch({location:'No account',techStack:['Node']})).status).toBe(401);
    expect(await UserProfile.countDocuments()).toBe(0);
  });
});
