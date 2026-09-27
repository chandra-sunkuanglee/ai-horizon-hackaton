# Render each narration line to demo/audio/<id>.wav with a built-in Windows voice.
param([string]$Voice = "Microsoft David Desktop", [int]$Rate = 0)
Add-Type -AssemblyName System.Speech
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$lines = Get-Content -Raw -Encoding UTF8 (Join-Path $root "narration.json") | ConvertFrom-Json
New-Item -ItemType Directory -Force (Join-Path $root "audio") | Out-Null
foreach ($l in $lines) {
    $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $s.SelectVoice($Voice)
    $s.Rate = $Rate
    $s.SetOutputToWaveFile((Join-Path $root "audio\$($l.id).wav"))
    $s.Speak($l.text)
    $s.Dispose()
}
