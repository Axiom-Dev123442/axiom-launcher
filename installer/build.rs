fn main() {
    // Give the Windows executable the Obsidian icon and version details.
    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../build/icon.ico");
        res.set("ProductName", "Obsidian");
        res.set("FileDescription", "Obsidian Setup");
        res.set("CompanyName", "lazentho");
        res.compile().expect("failed to embed Windows resources");
    }
    println!("cargo:rerun-if-changed=../build/icon.ico");
}
