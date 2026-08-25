# Relatório de QA — Fase 3: Voz e Vídeo

Data da validação final: 24/08/2026  
Resultado: **APROVADA**

## Resumo executivo

A Fase 3 foi revalidada após a correção dos bloqueadores de publicação do
compartilhamento de tela, reentrada na mesma sala, isolamento de preferências
de mídia entre sessões e disponibilidade do controle de ensurdecer.

Todos os critérios da Fase 3 em `task.md` estão implementados, possuem cobertura
automatizada e o gate completo do repositório está verde.

## Correções finais validadas

- Os presets 720p30, 720p60, 1080p30 e 1080p60 enviam resolução e FPS para a
  captura e também `screenShareEncoding` para a publicação LiveKit.
- As codificações usam, respectivamente, 2, 4, 5 e 10 Mbps, com
  `maxFramerate` de 30 ou 60 conforme a seleção.
- Depois de sair de uma chamada, a tela oferece “Entrar no canal de voz”; em
  caso de erro, oferece “Tentar novamente”, sem exigir troca de canal.
- Logout limpa `micMuted`, `deafened` e `cameraEnabled` antes de finalizar a
  sessão, impedindo que outra conta herde câmera ou áudio.
- Alterações rápidas do microfone são serializadas para preservar a última
  intenção do usuário.
- O botão de ensurdecer permanece acessível também abaixo de 900 px.

## Evidência automatizada

Testes focados após os incrementos:

```text
Store de voz:             56/56 aprovados
Integração/UI corrigida: 118/118 aprovados
```

Gate completo:

```powershell
npm run check
```

Resultado:

```text
Prisma generate/validate: aprovado
Build:                    aprovado
Typecheck dos workspaces: aprovado
API:                      34/34 testes aprovados
Frontend:                 184/184 testes aprovados (11 arquivos)
```

## Evidência no navegador

Em uma sessão real conectada ao LiveKit local:

1. O usuário entrou em `Lobby Neon` e recebeu `Voice Connected`.
2. Clicou em “Sair” e permaneceu no mesmo canal.
3. A ação “Entrar no canal de voz” foi exibida e reconectou à mesma sala.
4. Microfone e ensurdecer foram ativados; após logout/login, ambos voltaram ao
   padrão seguro, sem preferência herdada.
5. O botão “Ensurdecer áudio” foi renderizado com `grid`, sem `hidden` ou regra
   que o esconda abaixo de 900 px.

O smoke anterior com dois clientes reais na mesma sala também permanece válido:
ambos concluíram a negociação WebRTC e visualizaram um participante remoto.

As permissões de câmera e captura de tela não foram concedidas pelo navegador
automatizado. Esses caminhos foram validados por testes de permissão, presets,
publicação, cancelamento e cleanup, incluindo o terceiro argumento real esperado
pela API `setScreenShareEnabled` do LiveKit.

## Observação não bloqueadora

O build emite aviso de bundle JavaScript com aproximadamente 821 kB. Isso não
impede o aceite funcional da Fase 3, mas recomenda-se code splitting durante o
polimento de performance.

## Higiene de QA

A conta, sessões, membership, aba e processos temporários usados na validação
foram removidos ao final. Nenhum dado de usuário real foi alterado.
