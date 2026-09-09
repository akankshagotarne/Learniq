Add-Type -AssemblyName System.Drawing

$src = "C:\Users\Akanksha\.gemini\antigravity-ide\brain\7c005add-be4c-4c91-9e44-b9447ffc7d10\.user_uploaded\media_1788948395500.jpg"
$outDir = "c:\LearnIQ\frontend\public\assets\teachers"

if (-not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}

$orig = [System.Drawing.Bitmap]::FromFile($src)

function Crop-Teacher($x, $y, $w, $h, $fileName) {
    # Ensure bounds stay within image
    if ($x + $w -gt $orig.Width) { $w = $orig.Width - $x }
    if ($y + $h -gt $orig.Height) { $h = $orig.Height - $y }
    
    $rect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)
    $cropped = $orig.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    
    $dest = Join-Path $outDir $fileName
    $cropped.Save($dest, [System.Drawing.Imaging.ImageFormat]::Jpeg)
    $cropped.Dispose()
    Write-Host "Cropped $fileName ($w x $h from x:$x, y:$y)"
}

# Top Row: frame each teacher with their head, body, and full nameplate
Crop-Teacher 42 120 190 218 "sunita-sharma.jpg"
Crop-Teacher 285 120 195 218 "rohit-gupta.jpg"
Crop-Teacher 528 120 195 218 "aisha-khan.jpg"
Crop-Teacher 768 120 195 218 "priya-patel.jpg"

# Bottom Row: frame each teacher with their head, body, and full nameplate
Crop-Teacher 158 320 195 218 "ravi-singh.jpg"
Crop-Teacher 402 320 202 218 "fatima-shaikh.jpg"
Crop-Teacher 652 320 202 218 "michael-desilva.jpg"

$orig.Dispose()
Write-Host "All 7 teachers cropped successfully!"
