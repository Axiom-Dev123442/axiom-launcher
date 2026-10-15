//! Axiom Setup: a small custom installer. It downloads the full Axiom
//! installer from the latest GitHub release, runs it silently into the folder
//! the person picked, and then starts Axiom.

#![cfg_attr(windows, windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use eframe::egui::{
    self, Align2, Color32, CornerRadius, FontFamily, FontId, Pos2, Rect, Sense, Stroke, Vec2,
};
use sha2::{Digest, Sha512};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const DOWNLOAD_URL: &str =
    "https://github.com/axiomdev/axiom-launcher/releases/latest/download/Axiom-Full-Setup.exe";
const WIDTH: f32 = 680.0;
const HEIGHT: f32 = 420.0;
const SIDE: f32 = 250.0;

// Palette, matching the launcher's Axiom theme.
const BG: Color32 = Color32::from_rgb(12, 11, 18);
const SURFACE: Color32 = Color32::from_rgb(22, 20, 31);
const SURFACE_HOVER: Color32 = Color32::from_rgb(30, 27, 42);
const BORDER: Color32 = Color32::from_rgb(40, 36, 54);
const TEXT: Color32 = Color32::from_rgb(242, 240, 248);
const TEXT_2: Color32 = Color32::from_rgb(178, 172, 196);
const TEXT_3: Color32 = Color32::from_rgb(122, 116, 142);
const ACCENT: Color32 = Color32::from_rgb(123, 97, 209);
const ACCENT_HOVER: Color32 = Color32::from_rgb(138, 113, 222);
const SUCCESS: Color32 = Color32::from_rgb(52, 178, 102);
const DANGER: Color32 = Color32::from_rgb(232, 82, 104);

#[derive(Clone, PartialEq)]
enum Phase {
    Welcome,
    Downloading,
    Installing,
    Done,
    Failed(String),
}

struct Progress {
    phase: Phase,
    done: u64,
    total: u64,
    speed: f64,
}

struct App {
    logo: egui::TextureHandle,
    opened: Instant,
    page: u8,
    page_since: Instant,
    progress: Arc<Mutex<Progress>>,
    dir: PathBuf,
    launch_after: bool,
    demo: bool,
}

fn default_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir());
    base.join("Programs").join("Axiom")
}

fn installed(dir: &PathBuf) -> bool {
    dir.join("Axiom.exe").exists()
}

fn mb(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1_048_576.0)
}

/* ---------- Install work (runs on a background thread) ---------- */

fn set_phase(p: &Arc<Mutex<Progress>>, phase: Phase) {
    p.lock().unwrap().phase = phase;
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .try_proxy_from_env(true)
        .timeout_connect(Duration::from_secs(20))
        .build()
}

/// The release's latest.yml sits next to the installer. electron-builder writes
/// the installer's SHA-512 (base64) into it as a top-level `sha512:` line.
fn expected_sha512(setup_url: &str) -> Result<String, String> {
    let base = setup_url
        .rsplit_once('/')
        .map(|(base, _)| base)
        .ok_or("The download address is not valid.")?;
    let text = agent()
        .get(&format!("{base}/latest.yml"))
        .call()
        .map_err(|e| format!("Couldn't reach GitHub. Check your internet connection.\n({e})"))?
        .into_string()
        .map_err(|e| format!("Couldn't read the release details: {e}"))?;
    text.lines()
        .find_map(|line| line.strip_prefix("sha512:"))
        .map(|v| v.trim().trim_matches(|c: char| c == '\'' || c == '"').to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "The release has no checksum for the installer, so it wasn't run.".to_string())
}

/// Downloads url to dest and returns the file's SHA-512 as base64.
fn download(p: &Arc<Mutex<Progress>>, url: &str, dest: &PathBuf) -> Result<String, String> {
    let resp = agent()
        .get(url)
        .call()
        .map_err(|e| format!("Couldn't reach GitHub. Check your internet connection.\n({e})"))?;
    let total: u64 = resp.header("Content-Length").and_then(|s| s.parse().ok()).unwrap_or(0);
    {
        let mut g = p.lock().unwrap();
        g.total = total;
        g.done = 0;
    }
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(dest).map_err(|e| format!("Couldn't save the download: {e}"))?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut hasher = Sha512::new();
    let start = Instant::now();
    let mut done: u64 = 0;
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("The download stopped: {e}"))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        file.write_all(&buf[..n]).map_err(|e| format!("Couldn't save the download: {e}"))?;
        done += n as u64;
        let mut g = p.lock().unwrap();
        g.done = done;
        g.speed = done as f64 / start.elapsed().as_secs_f64().max(0.001);
    }
    if total > 0 && done != total {
        return Err("The download was incomplete. Please try again.".into());
    }
    file.sync_all().map_err(|e| format!("Couldn't save the download: {e}"))?;
    Ok(BASE64.encode(hasher.finalize()))
}

/// A new, empty folder for this run's download, so nothing else can have put a
/// file at the path that gets run.
fn fresh_temp_dir() -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("axiom-setup-{}-{stamp}", std::process::id()));
    std::fs::create_dir(&dir).map_err(|e| format!("Couldn't prepare the download folder: {e}"))?;
    Ok(dir)
}

#[cfg(windows)]
fn run_installer(setup: &PathBuf, dir: &PathBuf) -> Result<(), String> {
    // NSIS silent install; /D must be the last argument and unquoted.
    let status = std::process::Command::new(setup)
        .arg("/S")
        .arg(format!("/D={}", dir.display()))
        .status()
        .map_err(|e| format!("Couldn't start the installer: {e}"))?;
    if !status.success() {
        return Err(format!("The installer stopped with code {}.", status.code().unwrap_or(-1)));
    }
    if !installed(dir) {
        return Err("Axiom wasn't found after installing. Please try again.".into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn run_installer(_setup: &PathBuf, _dir: &PathBuf) -> Result<(), String> {
    Err("Axiom Setup only installs on Windows.".into())
}

fn install(p: Arc<Mutex<Progress>>, dir: PathBuf, demo: bool) {
    let result = (|| -> Result<(), String> {
        set_phase(&p, Phase::Downloading);
        if demo {
            let total = 83 * 1_048_576u64;
            p.lock().unwrap().total = total;
            for i in 1..=120u64 {
                std::thread::sleep(Duration::from_millis(50));
                let mut g = p.lock().unwrap();
                g.done = total * i / 120;
                g.speed = 13.8 * 1_048_576.0;
            }
            set_phase(&p, Phase::Installing);
            std::thread::sleep(Duration::from_millis(1800));
            return Ok(());
        }
        let url = std::env::var("AXIOM_SETUP_URL").unwrap_or_else(|_| DOWNLOAD_URL.to_string());
        let expected = expected_sha512(&url)?;
        let tmp = fresh_temp_dir()?;
        let setup = tmp.join("Axiom-Full-Setup.exe");
        let r = download(&p, &url, &setup).and_then(|actual| {
            if actual != expected {
                return Err("The download didn't match the release's checksum, so it wasn't run. \
                            A new version may have just been published. Please try again."
                    .into());
            }
            set_phase(&p, Phase::Installing);
            run_installer(&setup, &dir)
        });
        let _ = std::fs::remove_dir_all(&tmp);
        r
    })();
    set_phase(&p, match result {
        Ok(()) => Phase::Done,
        Err(e) => Phase::Failed(e),
    });
}

fn launch(dir: &PathBuf) {
    let _ = std::process::Command::new(dir.join("Axiom.exe")).spawn();
}

/* ---------- Drawing helpers ---------- */

/// Fills a rect with a large-pixel obsidian block pattern (drawn here, not
/// taken from the game), so the brand panel reads as Minecraft without art assets.
fn obsidian_texture(painter: &egui::Painter, rect: Rect, pixel: f32) {
    const BASE: [Color32; 5] = [
        Color32::from_rgb(18, 13, 30),
        Color32::from_rgb(22, 15, 36),
        Color32::from_rgb(15, 11, 24),
        Color32::from_rgb(26, 18, 41),
        Color32::from_rgb(20, 14, 33),
    ];
    const SPECK: [Color32; 3] = [Color32::from_rgb(52, 37, 82), Color32::from_rgb(44, 31, 69), Color32::from_rgb(64, 46, 100)];
    let mut seed: u32 = 0x9e37_79b9;
    let mut next = move || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed
    };
    let cols = (rect.width() / pixel).ceil() as i32;
    let rows = (rect.height() / pixel).ceil() as i32;
    for y in 0..rows {
        for x in 0..cols {
            let r = next();
            let color = if r % 23 == 0 { SPECK[(r as usize / 23) % SPECK.len()] } else { BASE[(r as usize) % BASE.len()] };
            let min = Pos2::new(rect.left() + x as f32 * pixel, rect.top() + y as f32 * pixel);
            let cell = Rect::from_min_size(min, Vec2::splat(pixel)).intersect(rect);
            painter.rect_filled(cell, CornerRadius::ZERO, color);
        }
    }
}

/// Ease-out cubic progress for an animation that started `since` and lasts `secs`.
fn ease(since: Instant, secs: f32) -> f32 {
    let t = (since.elapsed().as_secs_f32() / secs).clamp(0.0, 1.0);
    1.0 - (1.0 - t).powi(3)
}

fn mix(a: Color32, b: Color32, t: f32) -> Color32 {
    let l = |x: u8, y: u8| (x as f32 + (y as f32 - x as f32) * t).round() as u8;
    Color32::from_rgba_premultiplied(l(a.r(), b.r()), l(a.g(), b.g()), l(a.b(), b.b()), l(a.a(), b.a()))
}

fn stroke(width: f32, color: Color32) -> Stroke {
    Stroke::new(width, color)
}

fn font(size: f32) -> FontId {
    FontId::new(size, FontFamily::Proportional)
}

fn bold(size: f32) -> FontId {
    FontId::new(size, FontFamily::Name("bold".into()))
}

/// A flat button drawn by hand so it matches the launcher. Returns true when clicked.
fn button(ui: &mut egui::Ui, rect: Rect, label: &str, primary: bool, id: &str) -> bool {
    let resp = ui.interact(rect, ui.id().with(id), Sense::click());
    let hovered = resp.hovered();
    let t = ui.ctx().animate_bool_with_time(ui.id().with(id).with("hover"), hovered, 0.15);
    let fill = if primary { mix(ACCENT, ACCENT_HOVER, t) } else { mix(SURFACE, SURFACE_HOVER, t) };
    let painter = ui.painter();
    painter.rect(rect, CornerRadius::same(6), fill, if primary { Stroke::NONE } else { stroke(1.0, BORDER) }, egui::StrokeKind::Inside);
    painter.text(rect.center(), Align2::CENTER_CENTER, label, bold(14.0), if primary { Color32::WHITE } else { TEXT });
    if hovered {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
    resp.clicked()
}

fn checkbox(ui: &mut egui::Ui, pos: Pos2, label: &str, value: &mut bool, id: &str) {
    let rect = Rect::from_min_size(pos, Vec2::new(220.0, 20.0));
    let resp = ui.interact(rect, ui.id().with(id), Sense::click());
    if resp.clicked() {
        *value = !*value;
    }
    let painter = ui.painter();
    let bx = Rect::from_min_size(pos + Vec2::new(0.0, 1.0), Vec2::splat(18.0));
    if *value {
        painter.rect_filled(bx, CornerRadius::same(4), ACCENT);
        let a = bx.left_top() + Vec2::new(4.5, 9.5);
        let b = bx.left_top() + Vec2::new(7.8, 12.8);
        let c = bx.left_top() + Vec2::new(13.8, 5.6);
        painter.line_segment([a, b], stroke(2.0, Color32::WHITE));
        painter.line_segment([b, c], stroke(2.0, Color32::WHITE));
    } else {
        painter.rect(bx, CornerRadius::same(4), SURFACE, stroke(1.0, BORDER), egui::StrokeKind::Inside);
    }
    painter.text(pos + Vec2::new(28.0, 10.0), Align2::LEFT_CENTER, label, font(13.5), TEXT_2);
    if resp.hovered() {
        ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
    }
}

fn progress_bar(painter: &egui::Painter, rect: Rect, fraction: Option<f32>, time: f64) {
    painter.rect_filled(rect, CornerRadius::same(4), SURFACE_HOVER);
    match fraction {
        Some(f) => {
            let fill = Rect::from_min_size(rect.min, Vec2::new(rect.width() * f.clamp(0.0, 1.0), rect.height()));
            painter.rect_filled(fill, CornerRadius::same(4), ACCENT);
            // A soft highlight sweeping across the filled part.
            let x = fill.left() + ((time * 0.6).fract() as f32) * (fill.width() + 80.0) - 80.0;
            let sheen = Rect::from_min_max(Pos2::new(x.max(fill.left()), fill.top()), Pos2::new((x + 80.0).min(fill.right()), fill.bottom()));
            if sheen.width() > 0.0 {
                painter.rect_filled(sheen, CornerRadius::same(4), Color32::from_rgba_unmultiplied(255, 255, 255, 28));
            }
        }
        None => {
            let w = rect.width() * 0.3;
            let x = rect.left() + ((time * 0.8).fract() as f32) * (rect.width() + w) - w;
            let bar = Rect::from_min_max(Pos2::new(x.max(rect.left()), rect.top()), Pos2::new((x + w).min(rect.right()), rect.bottom()));
            painter.rect_filled(bar, CornerRadius::same(4), ACCENT);
        }
    }
}

/* ---------- App ---------- */

fn load_fonts(ctx: &egui::Context) {
    let candidates: &[(&str, &[&str])] = &[
        ("regular", &["C:\\Windows\\Fonts\\segoeui.ttf", "/usr/share/fonts/opentype/inter/Inter-Regular.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]),
        ("bold", &["C:\\Windows\\Fonts\\seguisb.ttf", "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]),
        ("display", &["C:\\Windows\\Fonts\\segoeuib.ttf", "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]),
    ];
    let mut fonts = egui::FontDefinitions::default();
    for (name, paths) in candidates {
        if let Some(bytes) = paths.iter().find_map(|p| std::fs::read(p).ok()) {
            fonts.font_data.insert((*name).into(), Arc::new(egui::FontData::from_owned(bytes)));
        }
    }
    let fallback = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    let family = |first: &str| {
        let mut list = vec![];
        if fonts.font_data.contains_key(first) {
            list.push(first.to_string());
        }
        list.extend(fallback.clone());
        list
    };
    let regular = family("regular");
    let bold_family = family("bold");
    let display = family("display");
    fonts.families.insert(FontFamily::Proportional, regular);
    fonts.families.insert(FontFamily::Name("bold".into()), bold_family);
    fonts.families.insert(FontFamily::Name("display".into()), display);
    ctx.set_fonts(fonts);
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>) -> Self {
        load_fonts(&cc.egui_ctx);
        let demo = std::env::var("AXIOM_SETUP_DEMO").is_ok();
        let phase = match std::env::var("AXIOM_SETUP_PAGE").as_deref() {
            Ok("installing") => Phase::Downloading,
            Ok("done") => Phase::Done,
            Ok("failed") => Phase::Failed("Couldn't reach GitHub. Check your internet connection.".into()),
            _ => Phase::Welcome,
        };
        let progress = Arc::new(Mutex::new(Progress { phase, done: 51 * 1_048_576, total: 83 * 1_048_576, speed: 13.8 * 1_048_576.0 }));
        let logo = cc.egui_ctx.load_texture(
            "logo",
            egui::ColorImage::from_rgba_unmultiplied([160, 160], include_bytes!("../assets/logo160.rgba")),
            egui::TextureOptions::LINEAR,
        );
        App { logo, opened: Instant::now(), page: 255, page_since: Instant::now(), progress, dir: default_dir(), launch_after: true, demo }
    }

    fn start(&mut self) {
        let p = self.progress.clone();
        let dir = self.dir.clone();
        let demo = self.demo;
        std::thread::spawn(move || install(p, dir, demo));
    }

    #[cfg(windows)]
    fn pick_folder(&mut self) {
        if let Some(folder) = rfd::FileDialog::new().set_directory(&self.dir).pick_folder() {
            let ends_with_axiom = folder.file_name().map(|n| n.eq_ignore_ascii_case("Axiom")).unwrap_or(false);
            self.dir = if ends_with_axiom { folder } else { folder.join("Axiom") };
        }
    }

    #[cfg(not(windows))]
    fn pick_folder(&mut self) {}
}

impl eframe::App for App {
    fn clear_color(&self, _: &egui::Visuals) -> [f32; 4] {
        BG.to_normalized_gamma_f32()
    }

    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        let phase = self.progress.lock().unwrap().phase.clone();
        if matches!(phase, Phase::Downloading | Phase::Installing) {
            ctx.request_repaint_after(Duration::from_millis(16));
        }
        let time = ctx.input(|i| i.time);
        // Fade in on open, and slide each new page in.
        let kind = match phase {
            Phase::Welcome => 0,
            Phase::Downloading | Phase::Installing => 1,
            Phase::Done => 2,
            Phase::Failed(_) => 3,
        };
        if kind != self.page {
            if self.page != 255 {
                self.page_since = Instant::now();
            }
            self.page = kind;
        }
        let intro = ease(self.opened, 0.45);
        let page_t = ease(self.page_since, 0.35);
        let check_t = ease(self.page_since, 0.6);
        if intro < 1.0 || page_t < 1.0 || check_t < 1.0 {
            ctx.request_repaint();
        }

        egui::CentralPanel::default().frame(egui::Frame::NONE.fill(BG)).show(ctx, |ui| {
            let full = ui.max_rect();
            ui.multiply_opacity(intro);
            let painter = ui.painter().clone();

            // Left brand panel
            let side = Rect::from_min_size(full.min, Vec2::new(SIDE, full.height()));
            obsidian_texture(&painter, side, 25.0);
            painter.line_segment([side.right_top(), side.right_bottom()], stroke(1.0, BORDER));
            let lc = Pos2::new(side.center().x, side.top() + 150.0 + (1.0 - intro) * 10.0);
            let logo_rect = Rect::from_center_size(lc, Vec2::splat(112.0));
            painter.image(self.logo.id(), logo_rect, Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0)), Color32::WHITE);
            painter.text(Pos2::new(lc.x, lc.y + 80.0), Align2::CENTER_CENTER, "Axiom", FontId::new(24.0, FontFamily::Name("display".into())), TEXT);
            painter.text(Pos2::new(lc.x, lc.y + 106.0), Align2::CENTER_CENTER, "Minecraft launcher", font(13.0), TEXT_2);
            painter.text(Pos2::new(side.left() + 20.0, side.bottom() - 22.0), Align2::LEFT_CENTER, format!("Setup {}", env!("CARGO_PKG_VERSION")), font(11.5), TEXT_3);

            // Title bar: drag area plus minimize and close
            let bar = Rect::from_min_max(Pos2::new(side.right(), full.top()), Pos2::new(full.right(), full.top() + 38.0));
            let drag = ui.interact(bar, ui.id().with("drag"), Sense::click_and_drag());
            if drag.drag_started() {
                ctx.send_viewport_cmd(egui::ViewportCommand::StartDrag);
            }
            let close = Rect::from_min_size(Pos2::new(full.right() - 46.0, full.top()), Vec2::new(46.0, 34.0));
            let min = Rect::from_min_size(Pos2::new(full.right() - 92.0, full.top()), Vec2::new(46.0, 34.0));
            let busy = matches!(phase, Phase::Downloading | Phase::Installing);
            for (rect, which) in [(min, "min"), (close, "close")] {
                let r = ui.interact(rect, ui.id().with(which), Sense::click());
                if r.hovered() {
                    painter.rect_filled(rect, CornerRadius::ZERO, if which == "close" { Color32::from_rgb(196, 43, 28) } else { SURFACE_HOVER });
                }
                let c = rect.center();
                if which == "close" {
                    painter.line_segment([c + Vec2::new(-5.0, -5.0), c + Vec2::new(5.0, 5.0)], stroke(1.3, TEXT_2));
                    painter.line_segment([c + Vec2::new(-5.0, 5.0), c + Vec2::new(5.0, -5.0)], stroke(1.3, TEXT_2));
                    if r.clicked() && !busy {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                } else {
                    painter.line_segment([c + Vec2::new(-5.0, 0.0), c + Vec2::new(5.0, 0.0)], stroke(1.3, TEXT_2));
                    if r.clicked() {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Minimized(true));
                    }
                }
            }

            // Content area (slides in from the right when the page changes)
            ui.multiply_opacity(page_t);
            let painter = ui.painter().clone();
            let dx = (1.0 - page_t) * 18.0;
            let x = side.right() + 40.0 + dx;
            let right = full.right() - 40.0 + dx;
            let top = full.top() + 74.0;
            let bottom_btn = Rect::from_min_size(Pos2::new(right - 150.0, full.bottom() - 74.0), Vec2::new(150.0, 42.0));
            let second_btn = Rect::from_min_size(Pos2::new(right - 260.0, full.bottom() - 74.0), Vec2::new(98.0, 42.0));

            match phase {
                Phase::Welcome => {
                    let update = installed(&self.dir);
                    painter.text(Pos2::new(x, top), Align2::LEFT_TOP, if update { "Update Axiom" } else { "Install Axiom" }, FontId::new(28.0, FontFamily::Name("display".into())), TEXT);
                    painter.text(Pos2::new(x, top + 44.0), Align2::LEFT_TOP, "Setup downloads about 85 MB from GitHub", font(14.0), TEXT_2);
                    painter.text(Pos2::new(x, top + 64.0), Align2::LEFT_TOP, "and adds Axiom to your Start menu.", font(14.0), TEXT_2);

                    painter.text(Pos2::new(x, top + 112.0), Align2::LEFT_TOP, "Install location", bold(12.5), TEXT_3);
                    let field = Rect::from_min_max(Pos2::new(x, top + 134.0), Pos2::new(right - 92.0, top + 172.0));
                    painter.rect(field, CornerRadius::same(6), SURFACE, stroke(1.0, BORDER), egui::StrokeKind::Inside);
                    let mut shown = self.dir.display().to_string();
                    let max_chars = ((field.width() - 24.0) / 7.2) as usize;
                    if shown.chars().count() > max_chars {
                        let tail: String = shown.chars().rev().take(max_chars.saturating_sub(1)).collect::<Vec<_>>().into_iter().rev().collect();
                        shown = format!("…{tail}");
                    }
                    painter.text(Pos2::new(field.left() + 12.0, field.center().y), Align2::LEFT_CENTER, shown, font(13.5), TEXT);
                    let change = Rect::from_min_max(Pos2::new(right - 82.0, field.top()), Pos2::new(right, field.bottom()));
                    if button(ui, change, "Change", false, "change") {
                        self.pick_folder();
                    }

                    checkbox(ui, Pos2::new(x, top + 194.0), "Start Axiom when it's installed", &mut self.launch_after, "launch");

                    if button(ui, bottom_btn, if update { "Update" } else { "Install" }, true, "install") {
                        self.start();
                    }
                    if button(ui, second_btn, "Cancel", false, "cancel") {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                }
                Phase::Downloading | Phase::Installing => {
                    let (done, total, speed) = {
                        let g = self.progress.lock().unwrap();
                        (g.done, g.total, g.speed)
                    };
                    let downloading = phase == Phase::Downloading;
                    painter.text(Pos2::new(x, top), Align2::LEFT_TOP, "Installing Axiom", FontId::new(28.0, FontFamily::Name("display".into())), TEXT);
                    painter.text(
                        Pos2::new(x, top + 44.0),
                        Align2::LEFT_TOP,
                        if downloading { "Downloading the latest version from GitHub." } else { "Copying files and adding shortcuts." },
                        font(14.0),
                        TEXT_2,
                    );
                    let bar = Rect::from_min_max(Pos2::new(x, top + 128.0), Pos2::new(right, top + 136.0));
                    let fraction = if downloading && total > 0 {
                        Some(ctx.animate_value_with_time(egui::Id::new("progress"), done as f32 / total as f32, 0.3))
                    } else {
                        None
                    };
                    progress_bar(&painter, bar, fraction, time);
                    let left_label = if downloading { format!("{} of {}", mb(done), mb(total)) } else { "Installing…".to_string() };
                    painter.text(Pos2::new(x, top + 150.0), Align2::LEFT_TOP, left_label, bold(13.0), TEXT);
                    if downloading && speed > 0.0 {
                        let remaining = if speed > 0.0 { (total.saturating_sub(done)) as f64 / speed } else { 0.0 };
                        painter.text(
                            Pos2::new(right, top + 150.0),
                            Align2::RIGHT_TOP,
                            format!("{}/s · {}s left", mb(speed as u64), remaining.ceil() as u64),
                            font(13.0),
                            TEXT_3,
                        );
                    }
                    let steps = [("Download", true), ("Install", !downloading), ("Ready", false)];
                    let mut sx = x;
                    for (i, (label, reached)) in steps.iter().enumerate() {
                        let c = Pos2::new(sx + 6.0, top + 208.0);
                        painter.circle_filled(c, 6.0, if *reached { ACCENT } else { SURFACE_HOVER });
                        painter.text(c + Vec2::new(14.0, 0.0), Align2::LEFT_CENTER, *label, font(13.0), if *reached { TEXT } else { TEXT_3 });
                        if i < steps.len() - 1 {
                            painter.line_segment([c + Vec2::new(86.0, 0.0), c + Vec2::new(108.0, 0.0)], stroke(1.0, BORDER));
                        }
                        sx += 122.0;
                    }
                }
                Phase::Done => {
                    let c = Pos2::new(x + 22.0, top + 22.0);
                    painter.circle_filled(c, 22.0, Color32::from_rgba_unmultiplied(52, 178, 102, 40));
                    let (a, b, d) = (c + Vec2::new(-9.0, 0.5), c + Vec2::new(-2.5, 7.0), c + Vec2::new(10.0, -7.0));
                    let first = (check_t / 0.4).min(1.0);
                    let second = ((check_t - 0.4) / 0.6).clamp(0.0, 1.0);
                    painter.line_segment([a, a + (b - a) * first], stroke(3.0, SUCCESS));
                    if second > 0.0 {
                        painter.line_segment([b, b + (d - b) * second], stroke(3.0, SUCCESS));
                    }
                    painter.text(Pos2::new(x, top + 64.0), Align2::LEFT_TOP, "Axiom is ready", FontId::new(28.0, FontFamily::Name("display".into())), TEXT);
                    painter.text(Pos2::new(x, top + 108.0), Align2::LEFT_TOP, "You'll find it in the Start menu and on your desktop.", font(14.0), TEXT_2);
                    painter.text(Pos2::new(x, top + 128.0), Align2::LEFT_TOP, "It keeps itself up to date from now on.", font(14.0), TEXT_2);
                    if button(ui, bottom_btn, "Launch Axiom", true, "launch-now") {
                        launch(&self.dir);
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                    if button(ui, second_btn, "Close", false, "close-done") {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                    // Starting automatically when that box was ticked.
                    if self.launch_after && !self.demo && std::env::var("AXIOM_SETUP_PAGE").is_err() {
                        self.launch_after = false;
                        launch(&self.dir);
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                }
                Phase::Failed(ref message) => {
                    let c = Pos2::new(x + 22.0, top + 22.0);
                    painter.circle_filled(c, 22.0, Color32::from_rgba_unmultiplied(232, 82, 104, 40));
                    painter.line_segment([c + Vec2::new(0.0, -9.0), c + Vec2::new(0.0, 3.0)], stroke(3.0, DANGER));
                    painter.circle_filled(c + Vec2::new(0.0, 9.0), 1.8, DANGER);
                    painter.text(Pos2::new(x, top + 64.0), Align2::LEFT_TOP, "Setup couldn't finish", FontId::new(28.0, FontFamily::Name("display".into())), TEXT);
                    let galley = painter.layout(message.clone(), font(14.0), TEXT_2, right - x);
                    painter.galley(Pos2::new(x, top + 108.0), galley, TEXT_2);
                    if button(ui, bottom_btn, "Try again", true, "retry") {
                        self.start();
                    }
                    if button(ui, second_btn, "Close", false, "close-failed") {
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                }
            }
        });

        // Development aid: AXIOM_SETUP_SHOT=path writes a screenshot (raw RGBA) and exits.
        #[cfg(not(windows))]
        screenshot(ctx);
    }
}

#[cfg(not(windows))]
fn screenshot(ctx: &egui::Context) {
    let Ok(path) = std::env::var("AXIOM_SETUP_SHOT") else { return };
    static REQUESTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if ctx.input(|i| i.time) > 1.2 && !REQUESTED.swap(true, std::sync::atomic::Ordering::Relaxed) {
        ctx.send_viewport_cmd(egui::ViewportCommand::Screenshot(Default::default()));
    }
    ctx.request_repaint();
    let shot = ctx.input(|i| {
        i.events.iter().find_map(|e| match e {
            egui::Event::Screenshot { image, .. } => Some(image.clone()),
            _ => None,
        })
    });
    if let Some(image) = shot {
        let mut out = format!("{} {}\n", image.size[0], image.size[1]).into_bytes();
        for p in &image.pixels {
            out.extend_from_slice(&p.to_array());
        }
        let _ = std::fs::write(path, out);
        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
    }
}

fn main() -> eframe::Result<()> {
    let icon = egui::IconData { rgba: include_bytes!("../assets/icon64.rgba").to_vec(), width: 64, height: 64 };
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Axiom Setup")
            .with_inner_size([WIDTH, HEIGHT])
            .with_resizable(false)
            .with_decorations(false)
            .with_icon(Arc::new(icon)),
        centered: true,
        ..Default::default()
    };
    eframe::run_native("Axiom Setup", options, Box::new(|cc| Ok(Box::new(App::new(cc)))))
}
