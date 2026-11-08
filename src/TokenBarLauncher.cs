using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using System.Threading;
using System.Text;

internal static class TokenBarLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        Mutex launchMutex = null;
        bool ownsLaunchMutex = false;
        bool focusOnly = false;
        try
        {
            string directory = AppDomain.CurrentDomain.BaseDirectory;
            string root = Directory.Exists(Path.Combine(directory, "scripts")) ? directory : Path.GetFullPath(Path.Combine(directory, ".."));
            string name = Path.GetFileNameWithoutExtension(Application.ExecutablePath);
            string script = Path.Combine(root, "scripts", "Start-TokenBar.ps1");
            bool check = (args.Length == 1 && args[0] == "--check") || name == "环境检查";
            bool setup = (args.Length == 1 && args[0] == "--setup") || name == "创建快捷方式";
            bool stop = (args.Length == 1 && args[0] == "--stop") || name == "关闭统计";
            bool original = (args.Length == 1 && args[0] == "--original") || name == "打开原版";
            if (!check && !setup && !stop && !original)
            {
                launchMutex = new Mutex(false, @"Local\CodexTokenBar.Launcher." + Environment.UserName);
                try { ownsLaunchMutex = launchMutex.WaitOne(0); }
                catch (AbandonedMutexException) { ownsLaunchMutex = true; }
                focusOnly = !ownsLaunchMutex;
                if (focusOnly)
                {
                    launchMutex.Dispose();
                    launchMutex = new Mutex(false, @"Local\CodexTokenBar.Focus." + Environment.UserName);
                    try { ownsLaunchMutex = launchMutex.WaitOne(0); }
                    catch (AbandonedMutexException) { ownsLaunchMutex = true; }
                    if (!ownsLaunchMutex) return 0;
                }
            }
            if (stop) script = Path.Combine(root, "scripts", "Stop-TokenBar.ps1");
            if (original) script = Path.Combine(root, "scripts", "Open-Codex.ps1");
            if (check) script = Path.Combine(root, "scripts", "Test-Environment.ps1");
            if (setup) script = Path.Combine(root, "scripts", "Setup-TokenBar.ps1");
            if (focusOnly) script = Path.Combine(root, "scripts", "Open-Codex.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("请保留 Codex TokenBar 文件夹结构。", script);
            string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            var info = new ProcessStartInfo(shell, "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"" + (focusOnly ? " -FocusOnly" : original ? " -OriginalOnly" : ""));
            info.WorkingDirectory = root;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            // Remain as the backend's parent; never terminate Codex or restart it.
            using (Process process = Process.Start(info))
            {
                var output = process.StandardOutput.ReadToEndAsync();
                var errors = process.StandardError.ReadToEndAsync();
                process.WaitForExit();
                if (check || setup)
                    MessageBox.Show(output.Result + (process.ExitCode == 0 ? "" : "\n" + errors.Result), "Codex TokenBar", MessageBoxButtons.OK, process.ExitCode == 0 ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
                else if (process.ExitCode != 0 && process.ExitCode != 2)
                {
                    string report = Path.Combine(root, "work", "tokenbar-start-error.txt");
                    string reason = errors.Result;
                    if (!focusOnly && File.Exists(report))
                    {
                        string log = File.ReadAllText(report);
                        int newline = log.IndexOf('\n');
                        reason = newline >= 0 ? log.Substring(newline + 1).Trim() : log;
                    }
                    MessageBox.Show("TokenBar 启动未完成。\n\n" + reason, "Codex TokenBar", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
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
