using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class ValidationLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool checkOnly = args.Length == 1 && args[0] == "--check";
        try
        {
            string root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
            string script = Path.Combine(root, "scripts", "Launch-Validation.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("请保留项目目录结构，启动脚本不存在。", script);
            string shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            var info = new ProcessStartInfo(shell,
                "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"" + (checkOnly ? " -CheckOnly" : ""));
            info.WorkingDirectory = root;
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardError = true;
            using (Process process = Process.Start(info))
            {
                string error = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0 && !checkOnly)
                    MessageBox.Show("静态验证启动失败。若 Codex 已在运行，请先正常退出，再点此入口。\n\n" + error,
                        "Codex TokenBar 验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            if (!checkOnly) MessageBox.Show(error.Message, "Codex TokenBar 验证", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 1;
        }
    }
}
