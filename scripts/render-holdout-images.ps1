param(
  [Parameter(Mandatory=$true)][string]$SpecPath,
  [Parameter(Mandatory=$true)][string]$OutDir
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$specs = Get-Content -Path $SpecPath -Raw -Encoding UTF8 | ConvertFrom-Json

function New-Color([string]$hex) {
  return [System.Drawing.ColorTranslator]::FromHtml($hex)
}

foreach ($spec in $specs) {
  $w = if ($spec.width) { [int]$spec.width } else { 960 }
  $h = if ($spec.height) { [int]$spec.height } else { 760 }
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $bgHex = if ($spec.bg) { $spec.bg } else { '#FFFFFF' }
  $g.Clear((New-Color $bgHex))

  # Optional header banner
  $y = 24
  if ($spec.header) {
    $hdrH = if ($spec.header.height) { [int]$spec.header.height } else { 72 }
    $hdrBrush = New-Object System.Drawing.SolidBrush((New-Color $spec.header.bg))
    $g.FillRectangle($hdrBrush, 0, 0, $w, $hdrH)
    $hdrFont = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
    $subFont = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Regular)
    $hdrTextBrush = New-Object System.Drawing.SolidBrush((New-Color $spec.header.fg))
    $g.DrawString($spec.header.title, $hdrFont, $hdrTextBrush, 28, 14)
    if ($spec.header.subtitle) {
      $g.DrawString($spec.header.subtitle, $subFont, $hdrTextBrush, 30, 44)
    }
    $hdrBrush.Dispose(); $hdrFont.Dispose(); $subFont.Dispose(); $hdrTextBrush.Dispose()
    $y = $hdrH + 22
  }

  # Optional columns layout (2-column brochure or 3-column rate card)
  if ($spec.columns) {
    $colCount = $spec.columns.Count
    $gap = 20
    $margin = 28
    $colW = [int](($w - ($margin * 2) - ($gap * ($colCount - 1))) / $colCount)
    $maxColY = $y
    for ($c = 0; $c -lt $colCount; $c++) {
      $col = $spec.columns[$c]
      $cx = $margin + ($c * ($colW + $gap))
      $boxH = if ($col.height) { [int]$col.height } else { 420 }
      $cardBg = if ($col.bg) { $col.bg } else { '#F8FAFC' }
      $borderHex = if ($col.border) { $col.border } else { '#CBD5E1' }
      $bBrush = New-Object System.Drawing.SolidBrush((New-Color $cardBg))
      $bPen = New-Object System.Drawing.Pen((New-Color $borderHex), 2)
      $g.FillRectangle($bBrush, $cx, $y, $colW, $boxH)
      $g.DrawRectangle($bPen, $cx, $y, $colW, $boxH)

      $cy = $y + 14
      if ($col.badge) {
        $badgeBrush = New-Object System.Drawing.SolidBrush((New-Color '#0F766E'))
        $badgeFg = New-Object System.Drawing.SolidBrush((New-Color '#FFFFFF'))
        $badgeFont = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
        $g.FillRectangle($badgeBrush, $cx + 14, $cy, 150, 22)
        $g.DrawString($col.badge, $badgeFont, $badgeFg, $cx + 20, $cy + 3)
        $badgeBrush.Dispose(); $badgeFg.Dispose(); $badgeFont.Dispose()
        $cy += 30
      }

      $tFont = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
      $tBrush = New-Object System.Drawing.SolidBrush((New-Color '#0F172A'))
      $g.DrawString($col.title, $tFont, $tBrush, $cx + 14, $cy)
      $cy += 28

      if ($col.price) {
        $pFont = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
        $pBrush = New-Object System.Drawing.SolidBrush((New-Color '#0369A1'))
        $g.DrawString($col.price, $pFont, $pBrush, $cx + 14, $cy)
        $pFont.Dispose(); $pBrush.Dispose()
        $cy += 26
      }

      $lFont = New-Object System.Drawing.Font('Segoe UI', 10.5, [System.Drawing.FontStyle]::Regular)
      $lBrush = New-Object System.Drawing.SolidBrush((New-Color '#1E293B'))
      foreach ($line in $col.lines) {
        $rect = New-Object System.Drawing.RectangleF(($cx + 14), $cy, ($colW - 28), 64)
        $g.DrawString($line, $lFont, $lBrush, $rect)
        $size = $g.MeasureString($line, $lFont, ($colW - 28))
        $cy += [int][Math]::Ceiling($size.Height) + 6
      }

      $tFont.Dispose(); $tBrush.Dispose(); $lFont.Dispose(); $lBrush.Dispose()
      $bBrush.Dispose(); $bPen.Dispose()
      if (($y + $boxH + 18) -gt $maxColY) { $maxColY = $y + $boxH + 18 }
    }
    $y = $maxColY
  }

  # Optional chat bubbles (Instagram DM / WhatsApp)
  if ($spec.bubbles) {
    foreach ($bub in $spec.bubbles) {
      $isRight = $bub.align -eq 'right'
      $bubW = [int]($w * 0.72)
      $bx = if ($isRight) { $w - $bubW - 32 } else { 32 }
      $bubBg = if ($bub.bg) { $bub.bg } elseif ($isRight) { '#DCFCE7' } else { '#F1F5F9' }
      $bubFg = if ($bub.fg) { $bub.fg } else { '#0F172A' }
      $font = New-Object System.Drawing.Font('Segoe UI', 11.5, [System.Drawing.FontStyle]::Regular)
      $textSize = $g.MeasureString($bub.text, $font, ($bubW - 28))
      $bh = [int][Math]::Ceiling($textSize.Height) + 34
      $brush = New-Object System.Drawing.SolidBrush((New-Color $bubBg))
      $pen = New-Object System.Drawing.Pen((New-Color '#CBD5E1'), 1)
      $g.FillRectangle($brush, $bx, $y, $bubW, $bh)
      $g.DrawRectangle($pen, $bx, $y, $bubW, $bh)

      $senderFont = New-Object System.Drawing.Font('Segoe UI', 9, [System.Drawing.FontStyle]::Bold)
      $senderBrush = New-Object System.Drawing.SolidBrush((New-Color '#475569'))
      $g.DrawString($bub.sender, $senderFont, $senderBrush, $bx + 14, $y + 6)

      $textBrush = New-Object System.Drawing.SolidBrush((New-Color $bubFg))
      $rect = New-Object System.Drawing.RectangleF(($bx + 14), ($y + 24), ($bubW - 28), ($bh - 24))
      $g.DrawString($bub.text, $font, $textBrush, $rect)

      $brush.Dispose(); $pen.Dispose(); $font.Dispose(); $senderFont.Dispose(); $senderBrush.Dispose(); $textBrush.Dispose()
      $y += $bh + 14
    }
  }

  # Standard lines / footer / fine print
  if ($spec.blocks) {
    foreach ($blk in $spec.blocks) {
      $fSize = if ($blk.size) { [single]$blk.size } else { 11.5 }
      $fStyle = if ($blk.bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
      $fgHex = if ($blk.fg) { $blk.fg } else { '#0F172A' }
      $font = New-Object System.Drawing.Font('Segoe UI', $fSize, $fStyle)
      $brush = New-Object System.Drawing.SolidBrush((New-Color $fgHex))

      if ($blk.boxBg) {
        $size = $g.MeasureString($blk.text, $font, ($w - 84))
        $boxH = [int][Math]::Ceiling($size.Height) + 20
        $boxBrush = New-Object System.Drawing.SolidBrush((New-Color $blk.boxBg))
        $boxPen = New-Object System.Drawing.Pen((New-Color '#94A3B8'), 1.5)
        $g.FillRectangle($boxBrush, 28, $y, ($w - 56), $boxH)
        $g.DrawRectangle($boxPen, 28, $y, ($w - 56), $boxH)
        $rect = New-Object System.Drawing.RectangleF(42, ($y + 10), ($w - 84), ($boxH - 10))
        $g.DrawString($blk.text, $font, $brush, $rect)
        $boxBrush.Dispose(); $boxPen.Dispose()
        $y += $boxH + 12
      } else {
        $size = $g.MeasureString($blk.text, $font, ($w - 56))
        $rect = New-Object System.Drawing.RectangleF(28, $y, ($w - 56), ([Math]::Ceiling($size.Height) + 8))
        $g.DrawString($blk.text, $font, $brush, $rect)
        $y += [int][Math]::Ceiling($size.Height) + 8
      }
      $font.Dispose(); $brush.Dispose()
    }
  }

  $outFile = Join-Path $OutDir ($spec.id + '.png')
  $bmp.Save($outFile, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

Write-Output ("Rendered " + $specs.Count + " PNG images into " + $OutDir)
