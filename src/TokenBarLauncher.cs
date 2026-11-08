using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using System.Threading;

internal static class TokenBarLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        Mutex launchMutex = null;
        bool ownsLaunchMutex = false;
        try
        {
            string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            string script = Path.Combine(root, "scripts", "Start-TokenBar.ps1");
            bool check = args.Length == 1 && args[0] == "--check";
            bool stop = args.Length == 1 && args[0] == "--stop";
            bool original = args.Length == 1 && args[0] == "--original";
            if (!check && !stop && !original)
            {
                launchMutex = new Mutex(false, @"Local\CodexTokenBar.Launcher." + Environment.UserName);
                try { ownsLaunchMutex = launchMutex.WaitOne(0); }
                catch (AbandonedMutexException) { ownsLaunchMutex = true; }
                if (!ownsLaunchMutex) return 0;
            }
            if (stop) script = Path.Combine(root, "scripts", "Stop-TokenBar.ps1");
            if (original) script = Path.Combine(root, "scripts", "Open-Codex.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("请保留 Codex TokenBar 文件夹结构。", script);
            string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            var info = new ProcessStartInfo(shell, "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"" + (check ? " -CheckOnly" : original ? " -OriginalOnly" : ""));
            info.WorkingDirectory = root;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            // Remain as the backend's parent; never terminate Codex or restart it.
            using (Process process = Process.Start(info))
            {
                process.WaitForExit();
                if (process.ExitCode != 0 && process.ExitCode != 2 && !check)
                    MessageBox.Show("TokenBar 未能连接，Codex 不会被关闭或重启。若从原版入口打开的 Codex 仍在运行，请在方便时正常退出，再使用 TokenBar 入口打开。\n检查记录：work/tokenbar-start-error.txt", "Codex TokenBar", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Codex TokenBar", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }
        finally
        {
            if (ownsLaunchMutex) launchMutex.ReleaseMutex();
            if (launchMutex != null) launchMutex.Dispose();
        }
    }
}
