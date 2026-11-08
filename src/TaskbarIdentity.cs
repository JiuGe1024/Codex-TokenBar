using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace TokenBar
{
    // Windows Shell property-store API; never edits taskbar registry state.
    public static class TaskbarIdentity
    {
        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        struct PropertyKey { public Guid Format; public uint Id; }
        [StructLayout(LayoutKind.Explicit, Size = 24)]
        struct PropVariant
        {
            [FieldOffset(0)] public ushort Type;
            [FieldOffset(8)] public IntPtr Pointer;
        }
        [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IPropertyStore
        {
            void GetCount(out uint count);
            void GetAt(uint index, out PropertyKey key);
            void GetValue(ref PropertyKey key, out PropVariant value);
            void SetValue(ref PropertyKey key, ref PropVariant value);
            void Commit();
        }
        [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
        class ShellLink { }
        [DllImport("shell32.dll", PreserveSig = false)]
        static extern void SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);
        [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        static extern void SHChangeNotify(uint change, uint flags, string first, IntPtr second);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern int GetApplicationUserModelId(IntPtr process, ref uint length, StringBuilder id);
        public static string ReadPackagedProcess(uint pid)
        {
            var handle = OpenProcess(0x1000, false, pid);
            if (handle == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                uint length = 0;
                int result = GetApplicationUserModelId(handle, ref length, null);
                if (result != 122 || length == 0 || length > 512) throw new InvalidOperationException("Cannot establish packaged process identity: " + result);
                var id = new StringBuilder((int)length);
                result = GetApplicationUserModelId(handle, ref length, id);
                if (result != 0) throw new System.ComponentModel.Win32Exception(result);
                return id.ToString();
            }
            finally { CloseHandle(handle); }
        }
        static PropertyKey AppIdKey() { return new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 }; }
        static string Read(IPropertyStore store)
        {
            var key = AppIdKey();
            PropVariant value;
            store.GetValue(ref key, out value);
            try
            {
                if (value.Type == 0) return null;
                if (value.Type != 31) throw new InvalidOperationException("Unexpected AppUserModelID property type.");
                return Marshal.PtrToStringUni(value.Pointer);
            }
            finally { Marshal.ThrowExceptionForHR(PropVariantClear(ref value)); }
        }
        public static string ReadWindow(long handle)
        {
            var iid = typeof(IPropertyStore).GUID;
            IPropertyStore store;
            SHGetPropertyStoreForWindow(new IntPtr(handle), ref iid, out store);
            try { return Read(store); }
            finally { Marshal.FinalReleaseComObject(store); }
        }
        public static string ReadShortcut(string path)
        {
            object link = new ShellLink();
            try { ((IPersistFile)link).Load(path, 0); return Read((IPropertyStore)link); }
            finally { Marshal.FinalReleaseComObject(link); }
        }
        public static void SetShortcut(string path, string id)
        {
            object link = new ShellLink();
            try
            {
                ((IPersistFile)link).Load(path, 2);
                var store = (IPropertyStore)link;
                var key = AppIdKey();
                var value = new PropVariant();
                if (!String.IsNullOrEmpty(id)) { value.Type = 31; value.Pointer = Marshal.StringToCoTaskMemUni(id); }
                try { store.SetValue(ref key, ref value); store.Commit(); ((IPersistFile)link).Save(path, true); }
                finally { Marshal.ThrowExceptionForHR(PropVariantClear(ref value)); }
            }
            finally { Marshal.FinalReleaseComObject(link); }
            SHChangeNotify(0x00002000, 0x00001005, path, IntPtr.Zero);
        }
    }
}
