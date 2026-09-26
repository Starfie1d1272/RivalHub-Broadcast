using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class Program
{
    private const string NodeHash = "__NODE_SHA256__";
    private const string SupervisorHash = "__SUPERVISOR_SHA256__";

    private static void Verify(string path, string expected)
    {
        using (var stream = File.OpenRead(path))
        using (var hash = SHA256.Create())
        {
            var actual = BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            if (actual != expected) throw new Exception("程序启动文件校验失败，请重新解压完整产品包。");
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        bool silent = Array.IndexOf(args, "--no-browser") >= 0;
        try
        {
            foreach (string arg in args)
                if (arg != "--stop" && arg != "--no-browser") throw new Exception("启动参数无法识别。");
            string root = AppDomain.CurrentDomain.BaseDirectory;
            string node = Path.Combine(root, "resources", "runtime", "node.exe");
            string supervisor = Path.Combine(root, "resources", "scripts", "product-runtime.mjs");
            Verify(node, NodeHash);
            Verify(supervisor, SupervisorHash);
            bool stop = Array.IndexOf(args, "--stop") >= 0;
            using (var mutex = new Mutex(false, @"Global\RivalHubBroadcastPort3000"))
            {
                bool owns = false;
                try
                {
                    if (!stop)
                    {
                        try { owns = mutex.WaitOne(0); }
                        catch (AbandonedMutexException) { owns = true; }
                    }
                    var info = new ProcessStartInfo(node);
                    info.Arguments = "\"" + supervisor + "\"" + (stop ? " --stop" : owns ? "" : " --reuse-only") + (silent ? " --no-browser" : "");
                    info.WorkingDirectory = root;
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.RedirectStandardError = true;
                    info.EnvironmentVariables.Remove("NODE_OPTIONS");
                    info.EnvironmentVariables.Remove("NODE_PATH");
                    var errors = new StringBuilder();
                    using (var child = Process.Start(info))
                    {
                        child.ErrorDataReceived += (sender, evt) => {
                            if (evt.Data == null) return;
                            lock (errors) {
                                errors.AppendLine(evt.Data);
                                if (errors.Length > 8192) errors.Remove(0, errors.Length - 8192);
                            }
                        };
                        child.BeginErrorReadLine();
                        child.WaitForExit();
                        if (child.ExitCode != 0) throw new Exception(errors.Length == 0 ? "制播服务启动失败，请查看 state/logs。" : errors.ToString());
                        return 0;
                    }
                }
                finally { if (owns) mutex.ReleaseMutex(); }
            }
        }
        catch (Exception error)
        {
            if (!silent) MessageBox.Show(error.Message, "RivalHub Broadcast", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
