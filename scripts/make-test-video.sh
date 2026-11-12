#!/usr/bin/env bash
# Gera um vídeo falado de teste (~30s, pt-BR, com pausas, uma repetição e números)
# para exercitar transcrição e agente. Requer ffmpeg e espeak-ng.
# Uso: scripts/make-test-video.sh [saida.webm]
set -euo pipefail
out="${1:-speech.webm}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
say() { espeak-ng -v pt-br -s 150 -w "$tmp/$1.wav" "$2"; }
say s1 "Olá pessoal, eu sou a Ana Souza. Hoje eu vou mostrar como a gente aumentou as vendas."
say s2 "No primeiro trimestre faturamos cento e vinte mil reais. No segundo, cento e oitenta mil. E no terceiro, trezentos e dez mil reais."
say s3 "O segredo, o segredo foi mudar a oferta. Preço não é o problema, a oferta é."
ffmpeg -y -loglevel error -i "$tmp/s1.wav" -i "$tmp/s2.wav" -i "$tmp/s3.wav" -filter_complex \
  "[0]adelay=800:all=1,apad=pad_dur=2.2[a];[1]apad=pad_dur=1.8[b];[2]apad=pad_dur=1.5[c];[a][b][c]concat=n=3:v=0:a=1[out]" \
  -map "[out]" -ar 48000 "$tmp/speech.wav"
dur="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$tmp/speech.wav")"
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=$dur" -i "$tmp/speech.wav" \
  -c:v libvpx-vp9 -b:v 800k -g 30 -c:a libopus -shortest "$out"
echo "ok: $out (${dur}s)"
