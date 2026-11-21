# Rebuilds a sprite sheet into an even grid: finds each frame by its empty-column gaps,
# then pastes every frame into an equal cell, centered, feet on the same bottom line.
# Usage: powershell -File normalize-sprites.ps1 <in.png> <out.png>
param([string]$In, [string]$Out)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Bitmap]::FromFile((Resolve-Path $In))
$w = $src.Width; $h = $src.Height

# Lock bits once for speed.
$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $src.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($data.Stride * $h)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$stride = $data.Stride
$src.UnlockBits($data)
function Alpha($x, $y) { $bytes[$y * $stride + $x * 4 + 3] }

# Columns that hold any visible pixel.
$colHas = New-Object bool[] $w
for ($x = 0; $x -lt $w; $x++) { for ($y = 0; $y -lt $h; $y += 2) { if ((Alpha $x $y) -gt 24) { $colHas[$x] = $true; break } } }

# Runs of visible columns = frames (ignore specks narrower than 20 px).
$runs = @(); $start = -1
for ($x = 0; $x -le $w; $x++) {
  $on = ($x -lt $w) -and $colHas[$x]
  if ($on -and $start -lt 0) { $start = $x }
  if (-not $on -and $start -ge 0) { if ($x - $start -ge 20) { $runs += ,@($start, ($x - 1)) }; $start = -1 }
}
"frames found: $($runs.Count)"

# Vertical bounds per frame.
$boxes = foreach ($r in $runs) {
  $top = $h; $bottom = -1
  for ($y = 0; $y -lt $h; $y++) { for ($x = $r[0]; $x -le $r[1]; $x += 2) { if ((Alpha $x $y) -gt 24) { if ($y -lt $top) { $top = $y }; if ($y -gt $bottom) { $bottom = $y }; break } } }
  ,@($r[0], $top, ($r[1] - $r[0] + 1), ($bottom - $top + 1))
}
$cellW = ($boxes | ForEach-Object { $_[2] } | Measure-Object -Maximum).Maximum + 8
$cellH = ($boxes | ForEach-Object { $_[3] } | Measure-Object -Maximum).Maximum + 8
"cell: ${cellW}x${cellH}"

$outBmp = New-Object System.Drawing.Bitmap ([int]($cellW * $boxes.Count)), ([int]$cellH), ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($outBmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$i = 0
foreach ($b in $boxes) {
  $dx = [int]($i * $cellW + ($cellW - $b[2]) / 2)
  $dy = [int]($cellH - 4 - $b[3])   # feet on the same line
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle $dx, $dy, $b[2], $b[3]), (New-Object System.Drawing.Rectangle $b[0], $b[1], $b[2], $b[3]), [System.Drawing.GraphicsUnit]::Pixel)
  $i++
}
$g.Dispose(); $src.Dispose()
$outBmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
"wrote $Out ($($outBmp.Width)x$($outBmp.Height), $($boxes.Count) frames of ${cellW}x${cellH})"
$outBmp.Dispose()
