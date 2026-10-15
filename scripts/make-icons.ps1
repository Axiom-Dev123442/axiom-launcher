<#
Builds every icon and installer image from the Axiom logo.

Sources:
  build/logo-source.png  the A mark on its dark tile (square, no transparency)
  build/logo-mark.png    the A mark alone on transparency
The tile gets rounded, transparent corners for the app icon; the bare mark is
used on light themes.
Run: npm run icons   (Windows only, uses the built-in System.Drawing)
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root 'build'
$assets = Join-Path $root 'assets'
$tileSrc = [System.Drawing.Image]::FromFile((Join-Path $build 'logo-source.png'))
$markSrc = [System.Drawing.Image]::FromFile((Join-Path $build 'logo-mark.png'))

function New-Canvas([int]$w, [int]$h) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.SmoothingMode = 'AntiAlias'
  $g.PixelOffsetMode = 'HighQuality'
  $g.CompositingQuality = 'HighQuality'
  return $bmp, $g
}

function Rounded([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# The dark tile with rounded, transparent corners (matches the tile's own glowing border).
function Tile([int]$size) {
  $bmp, $g = New-Canvas $size $size
  $inset = $size * 0.012
  $g.SetClip((Rounded $inset $inset ($size - 2 * $inset) ($size - 2 * $inset) ($size * 0.19)))
  $g.DrawImage($tileSrc, 0, 0, $size, $size)
  $g.Dispose()
  return $bmp
}

# The bare mark, centred with a little padding.
function Mark([int]$size) {
  $bmp, $g = New-Canvas $size $size
  $g.DrawImage($markSrc, 0, 0, $size, $size)
  $g.Dispose()
  return $bmp
}

function Save-Png($bmp, $file) {
  New-Item -ItemType Directory -Force (Split-Path $file) | Out-Null
  $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png)
}

# Raw RGBA bytes (not premultiplied) for the Rust installer.
function Save-Rgba($bmp, $file) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, 'ReadOnly', ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb))
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  for ($i = 0; $i -lt $bytes.Length; $i += 4) {
    $b = $bytes[$i]; $bytes[$i] = $bytes[$i + 2]; $bytes[$i + 2] = $b
  }
  [System.IO.File]::WriteAllBytes($file, $bytes)
}

# A Windows .ico with PNG-compressed frames (supported since Windows Vista).
function Save-Ico([int[]]$sizes, $file) {
  $frames = foreach ($s in $sizes) {
    $ms = New-Object System.IO.MemoryStream
    (Tile $s).Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    , $ms.ToArray()
  }
  $out = New-Object System.IO.MemoryStream
  $w = New-Object System.IO.BinaryWriter $out
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
  $offset = 6 + 16 * $sizes.Count
  for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $dim = if ($s -ge 256) { 0 } else { $s }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$frames[$i].Length); $w.Write([uint32]$offset)
    $offset += $frames[$i].Length
  }
  foreach ($f in $frames) { $w.Write($f) }
  $w.Flush()
  [System.IO.File]::WriteAllBytes($file, $out.ToArray())
}

function Text($g, [string]$text, [int]$px, [bool]$bold, $color, [single]$x, [single]$y, $align) {
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $style = if ($bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
  $font = New-Object System.Drawing.Font 'Segoe UI', $px, $style, ([System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = $align; $fmt.LineAlignment = 'Center'
  $g.DrawString($text, $font, (New-Object System.Drawing.SolidBrush $color), $x, $y, $fmt)
}

Save-Png (Tile 512) (Join-Path $build 'icon.png')
Save-Png (Tile 256) (Join-Path $assets 'icon.png')
Save-Png (Tile 128) (Join-Path $assets 'logo.png')
Save-Png (Mark 128) (Join-Path $assets 'logo-light.png')
Save-Ico @(16, 24, 32, 48, 64, 128, 256) (Join-Path $build 'icon.ico')

# The custom installer's window icon and the logo it draws.
Save-Rgba (Tile 64) (Join-Path $root 'installer\assets\icon64.rgba')
Save-Rgba (Tile 160) (Join-Path $root 'installer\assets\logo160.rgba')

# Discord art.
Save-Png (Tile 1024) (Join-Path $assets 'discord\axiom.png')

# NSIS images for the standard full installer.
$dark = [System.Drawing.Color]::FromArgb(20, 22, 28)
$side, $g = New-Canvas 164 314
$g.Clear([System.Drawing.Color]::FromArgb(245, 247, 250))
$g.DrawImage((Tile 96), 34, 70, 96, 96)
Text $g 'Axiom' 20 $true $dark 82 196 'Center'
Text $g 'Minecraft launcher' 11 $false ([System.Drawing.Color]::FromArgb(104, 112, 128)) 82 220 'Center'
$g.Dispose()
$side.Clone((New-Object System.Drawing.Rectangle 0, 0, 164, 314), [System.Drawing.Imaging.PixelFormat]::Format24bppRgb).Save((Join-Path $build 'installerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)

$header, $g = New-Canvas 150 57
$g.Clear([System.Drawing.Color]::White)
$g.DrawImage((Tile 44), 100, 6, 44, 44)
Text $g 'Axiom' 13 $true $dark 93 28 'Far'
$g.Dispose()
$header.Clone((New-Object System.Drawing.Rectangle 0, 0, 150, 57), [System.Drawing.Imaging.PixelFormat]::Format24bppRgb).Save((Join-Path $build 'installerHeader.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)

$tileSrc.Dispose(); $markSrc.Dispose()
Write-Output 'icons written'
