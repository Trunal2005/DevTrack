param([switch]$Stop, [string]$Root = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
if (-not ('DevTrack.OwnedRuntime' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
namespace DevTrack {
 public sealed class OwnedRuntime : IDisposable {
  IntPtr job;
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long a,b; public uint flags; public UIntPtr min,max; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public Basic basic; public Io io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public int cb; public string reserved,desktop,title; public int x,y,width,height,xChars,yChars,fill,flags; public short show,reserved2; public IntPtr reservedPtr,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref Limits limits,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int info,IntPtr data,uint size,IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out ProcessInfo info);
  public OwnedRuntime(string name) {
   job=CreateJobObject(IntPtr.Zero,name); int error=Marshal.GetLastWin32Error();
   if(job==IntPtr.Zero) throw new Win32Exception(error);
   if(error==183) { CloseHandle(job); job=IntPtr.Zero; throw new InvalidOperationException("DevTrack runtime is already starting/running; stop it first."); }
   var limits=new Limits(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE; descendants cannot break away.
   if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits)))) { error=Marshal.GetLastWin32Error(); Dispose(); throw new Win32Exception(error); }
  }
  public void Start(string executable,string arguments,string cwd) {
   if(job==IntPtr.Zero) throw new ObjectDisposedException("OwnedRuntime");
   var startup=new Startup(); startup.cb=Marshal.SizeOf(typeof(Startup)); ProcessInfo info;
   if(!CreateProcess(executable,new StringBuilder("\""+executable+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,cwd,ref startup,out info)) throw new Win32Exception();
   try {
    if(!AssignProcessToJobObject(job,info.process)) throw new Win32Exception();
    if(ResumeThread(info.thread)==uint.MaxValue) throw new Win32Exception();
   } catch { TerminateProcess(info.process,1); throw; }
   finally { CloseHandle(info.thread); CloseHandle(info.process); }
  }
  public static bool Stop(string name) {
   IntPtr handle=OpenJobObject(8,false,name);
   if(handle==IntPtr.Zero) { int error=Marshal.GetLastWin32Error(); if(error==2) return false; throw new Win32Exception(error); }
   try { if(!TerminateJobObject(handle,1)) throw new Win32Exception(); return true; }
   finally { CloseHandle(handle); }
  }
  public bool IsActive() {
   if(job==IntPtr.Zero) return false;
   IntPtr data=Marshal.AllocHGlobal(48);
   try { if(!QueryInformationJobObject(job,1,data,48,IntPtr.Zero)) throw new Win32Exception(); return Marshal.ReadInt32(data,40)>0; }
   finally { Marshal.FreeHGlobal(data); }
  }
  public void Dispose() { if(job!=IntPtr.Zero) { CloseHandle(job); job=IntPtr.Zero; } }
 }
}
'@
}
function Get-DevTrackJobName([string]$ProjectRoot) {
    $canonical = (Resolve-Path -LiteralPath $ProjectRoot).ProviderPath.TrimEnd('\').ToLowerInvariant()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))).Replace('-', '') }
    finally { $sha.Dispose() }
    return 'Local\DevTrack-' + $hash
}
if ($Stop) {
    $stopped = [DevTrack.OwnedRuntime]::Stop((Get-DevTrackJobName $Root))
    Write-Output $(if ($stopped) { 'Stopped owned DevTrack runtime.' } else { 'No owned DevTrack runtime; untracked processes were left running.' })
}
