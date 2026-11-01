# Windows development runtime ownership

`start-dev.ps1` launches backend, workers and frontend inside a Windows Job Object
named from the resolved checkout path. Each process is created suspended, assigned
to the job, then resumed. Descendants inherit membership. The launcher retains the
kernel handle; closing it also terminates the job, including on launcher exit.

`start-dev.ps1 -StopAll` and `npm run clean:runtime` stop only that checkout's job.
No PID files, image-wide kills or listening-port ownership guesses are used.
Untracked processes (including services launched manually with npm) remain running;
stop those from their own terminal. Other checkouts use distinct job names.

Job termination is forced. Hidden npm command trees do not offer a shared graceful
shutdown channel; there is no claim of worker queue draining here. Use the service's
own shutdown path when graceful draining is required. The job is an ownership
mechanism, not an authorization boundary against hostile processes in the same
Windows session. Existing Docker and file cleanup behavior is unchanged.

Run `powershell.exe -NoProfile -NonInteractive -File scripts/OwnedRuntime.test.ps1`
on Windows with Node installed. The regression owns disposable Node parents,
children and an unrelated sentinel; it cleans only its own handles and temporary
directory. Windows CI runs this check for changes to the runtime ownership paths.
