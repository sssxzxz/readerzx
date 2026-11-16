$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$out = Join-Path $repo ('work\windows-tts-' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
$null = New-Item -ItemType Directory -Path $out
$fixtureBase64 = & node (Join-Path $PSScriptRoot 'verify-narration-throughput.cjs') --fixture-base64
if ($LASTEXITCODE -ne 0) { throw 'Cannot load the shared benchmark fixture' }
$fixture = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($fixtureBase64)) | ConvertFrom-Json
Add-Type -TypeDefinition @'
using System;
using System.IO;
public static class ReaderPcmCheck {
 public static bool Active(byte[] b) { for(int i=0;i+1<b.Length;i+=2) if(Math.Abs((int)BitConverter.ToInt16(b,i))>128) return true; return false; }
 public static void Wave(string path, byte[] b) { using(var w=new BinaryWriter(File.Create(path))) { w.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));w.Write(36+b.Length);w.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt "));w.Write(16);w.Write((short)1);w.Write((short)1);w.Write(16000);w.Write(32000);w.Write((short)2);w.Write((short)16);w.Write(System.Text.Encoding.ASCII.GetBytes("data"));w.Write(b.Length);w.Write(b); } }
}
'@
$voice = $null
$token = $null
$stream = $null
try {
 $load = [Diagnostics.Stopwatch]::StartNew()
 $voice = New-Object -ComObject SAPI.SpVoice
 $token = New-Object -ComObject SAPI.SpObjectToken
 $token.SetId('HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Speech_OneCore\Voices\Tokens\MSTTS_V110_zhCN_KangkangM')
 $voice.Voice = $token
 $voice.Rate = 0
 $load.Stop()
 $hasher = [Security.Cryptography.SHA256]::Create()
 try { $textHash = [BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($fixture.long))).Replace('-', '').ToLowerInvariant() }
 finally { $hasher.Dispose() }
 $report = [ordered]@{
  ok=$false; measuredAt=[DateTime]::UtcNow.ToString('o'); root=$out; fixture=$fixture.name; longTextSha256=$textHash;
  model=$voice.Voice.GetDescription(); backend='Windows SAPI CPU'; voice_setup_s=$load.Elapsed.TotalSeconds;
  results=@(); measurement='Synthesis into an in-memory PCM stream only; no speaker playback. Timing includes 1 ms COM polling. First PCM is not physical output latency.'
 }
 $cases = @(@{name='short-1';text=$fixture.short},@{name='short-2';text=$fixture.short},@{name='short-3';text=$fixture.short},@{name='long-1';text=$fixture.long},@{name='long-2';text=$fixture.long},@{name='long-3';text=$fixture.long})
 foreach($case in $cases) {
  $stream = New-Object -ComObject SAPI.SpMemoryStream
  $stream.Format.Type = 18
  # Always bind the memory stream before Speak: the test never targets speakers.
  $voice.AudioOutputStream = $stream
  $first = $null; $signal = $null
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $null = $voice.Speak($case.text,1)
  do {
   $done = $voice.WaitUntilDone(1)
   $data = [byte[]]$stream.GetData()
   $at = $watch.Elapsed.TotalSeconds
   if($null -eq $first -and $data.Length -gt 0) { $first = $at }
   if($null -eq $signal -and [ReaderPcmCheck]::Active($data)) { $signal = $at }
   if($at -gt 60) { throw 'Windows synthesis timed out' }
  } until($done)
  $watch.Stop()
  $data = [byte[]]$stream.GetData()
  if($data.Length -lt 32000 -or $null -eq $signal) { throw 'Windows synthesis produced empty or silent audio' }
  $audioPath = Join-Path $out ($case.name+'.wav')
  [ReaderPcmCheck]::Wave($audioPath,$data)
  $duration = $data.Length/32000.0
  $result = [ordered]@{name=$case.name; text=$case.text; output=$audioPath; first_pcm_s=$first; first_non_silent_pcm_s=$signal; synthesis_s=$watch.Elapsed.TotalSeconds; audio_s=$duration; generation_seconds_per_audio_minute=$watch.Elapsed.TotalSeconds*60/$duration; sample_rate=16000}
  $report.results += $result
  [Runtime.InteropServices.Marshal]::ReleaseComObject($stream) | Out-Null
  $stream = $null
 }
 $longRates = @($report.results | Where-Object { $_.name.StartsWith('long-') } | ForEach-Object { $_.generation_seconds_per_audio_minute } | Sort-Object)
 $report.longMedianSecondsPerAudioMinute = $longRates[1]
 $report.ok = $true
 $json = $report | ConvertTo-Json -Depth 8
 [IO.File]::WriteAllText((Join-Path $out 'results.json'), $json, (New-Object Text.UTF8Encoding($false)))
 $json
} finally {
 if($null -ne $stream) { [Runtime.InteropServices.Marshal]::ReleaseComObject($stream) | Out-Null }
 if($null -ne $voice) { [Runtime.InteropServices.Marshal]::ReleaseComObject($voice) | Out-Null }
 if($null -ne $token) { [Runtime.InteropServices.Marshal]::ReleaseComObject($token) | Out-Null }
}
