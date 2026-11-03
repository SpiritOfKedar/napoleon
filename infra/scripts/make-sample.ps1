# Regenerates infra/sample/sample-meeting.wav with Windows' built-in text-to-speech.
# The committed file is what the seed uploads; you only need this script to change the script text.
# Usage (Windows PowerShell): powershell -ExecutionPolicy Bypass -File infra/scripts/make-sample.ps1
Add-Type -AssemblyName System.Speech

$out = Join-Path $PSScriptRoot '..\sample\sample-meeting.wav'
$lines = @(
  'Good morning everyone, and welcome to the quarterly planning meeting. Today we will cover the product roadmap, hiring, and the budget.',
  'First, the product roadmap. The mobile app redesign is on track, and we expect to ship the new onboarding flow in early spring.',
  'Next, hiring. We plan to add two backend engineers and one designer before the end of the year. Interviews start next week.',
  'Now let us talk about the Q3 budget. Marketing spending came in fifteen percent under plan, so we will move that money into the customer research program.',
  'On infrastructure, the database migration finished last Tuesday. Search latency dropped from eight hundred milliseconds to about one hundred and twenty.',
  'A quick note about the office. The kitchen on the third floor will be closed for renovation during the first two weeks of December.',
  'Finally, the company offsite will be held in Lisbon in March. Please submit your travel requests by the end of January.',
  'That is everything for today. Thank you all, and see you at the next meeting.'
)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 0
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile((Resolve-Path -LiteralPath (Split-Path $out)).Path + '\sample-meeting.wav', $format)

$marks = [System.Collections.Generic.List[double]]::new()
$synth.add_BookmarkReached({ param($s, $e) $marks.Add($e.AudioPosition.TotalSeconds) })

$prompt = New-Object System.Speech.Synthesis.PromptBuilder
foreach ($line in $lines) {
  $prompt.AppendBookmark("l")
  $prompt.AppendText($line)
  $prompt.AppendBreak([TimeSpan]::FromSeconds(1.5))
}
$synth.Speak($prompt)
$synth.Dispose()

# Record when each sentence starts, so the e2e check can verify search timestamps.
$json = for ($i = 0; $i -lt $lines.Count; $i++) {
  '  {"startSec": ' + [math]::Round($marks[$i], 2) + ', "text": "' + $lines[$i] + '"}'
}
$jsonPath = Join-Path $PSScriptRoot '..\sample\sample-meeting.json'
Set-Content -Encoding ascii -Path $jsonPath -Value ("[`n" + ($json -join ",`n") + "`n]")
Write-Output "Wrote $out and $jsonPath"
