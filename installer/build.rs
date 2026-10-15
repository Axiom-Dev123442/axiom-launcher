fn main() {
    // Give the Windows executable the Axiom icon and version details.
    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("../build/icon.ico");
        res.set("ProductName", "Axiom");
        res.set("FileDescription", "Axiom Setup");
        res.set("CompanyName", "axiomdev");
        res.compile().expect("failed to embed Windows resources");
    }
    println!("cargo:rerun-if-changed=../build/icon.ico");
}
