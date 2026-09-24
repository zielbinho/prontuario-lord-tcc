# Experimento B: lê um texto com a voz sintética pt-BR do Windows (Microsoft Maria) e grava um WAV
# de 16 kHz, 16 bits, mono. Substitui as gravações de voluntários, que não puderam ser feitas.
# Uso: powershell -NoProfile -File sintetizar_fala.ps1 -Texto caso.txt -Saida caso.wav
param([Parameter(Mandatory)] [string]$Texto, [Parameter(Mandatory)] [string]$Saida)

Add-Type -AssemblyName System.Speech
$sintetizador = New-Object System.Speech.Synthesis.SpeechSynthesizer
$sintetizador.SelectVoice("Microsoft Maria Desktop")
$sintetizador.Rate = 0
$formato = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$sintetizador.SetOutputToWaveFile($Saida, $formato)
$sintetizador.Speak([System.IO.File]::ReadAllText($Texto, [System.Text.Encoding]::UTF8))
$sintetizador.SetOutputToNull()
$sintetizador.Dispose()
