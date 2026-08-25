# Relatório de QA — Fase 4: Aplicação Desktop Nativa (Tauri)

Data da validação: 24/08/2026
Resultado final: **REMOVIDA DO ESCOPO por decisão do usuário (24/08/2026).**
Todo o código de desktop descrito abaixo foi revertido na mesma sessão —
`apps/web/src-tauri/`, `TitleBar.tsx`, o wrapper em `main.tsx`, as
dependências `@tauri-apps/*` e o suporte a múltiplas origens de CORS que só
existia para o shell desktop. Este documento fica como registro histórico da
tentativa (o que foi corrigido, o que funcionou, o que ficou pendente), caso
o desktop volte a ser considerado no futuro.

## Resumo executivo (estado no momento em que a Fase 4 estava em validação)

O handoff recebido não tinha um agente implementador ativo. A pedido do
usuário, o QA assumiu a correção de todos os defeitos encontrados como
fallback (AGENTS.md, seção "Papéis > Agente de QA", item 5). Nesta rodada
foram encontrados e corrigidos **quatro** defeitos distintos, todos com
evidência reproduzida — os dois primeiros já reportados antes, os dois
últimos descobertos ao tentar de fato compilar, empacotar e rodar o `.exe`
de verdade, apontado para o backend local:

1. Build quebrado por tipagem (`TitleBar.tsx`) — corrigido.
2. Identificador de bundle no valor padrão do template — corrigido.
3. **Novo:** caminho de assets do frontend não batia com o output do Vite — o
   `.exe` de release compilava mas mostrava tela preta ("asset not found:
   index.html"). Corrigido.
4. **Novo:** o backend só aceitava CORS de `http://localhost:5173`; o shell
   desktop roda a partir de `http://tauri.localhost`, então mesmo com o
   `.exe` funcionando ele não conseguiria falar com a API. Corrigido, com
   suporte a múltiplas origens.

`npm run check` passa integralmente: **39/39** testes da API (+5 novos desde
a última rodada), **186/186** testes web. O `.exe` de release compila,
empacota (MSI + NSIS) e a tela de login renderiza corretamente dentro do
shell desktop de verdade — evidência visual abaixo.

## Achado 1 — CORRIGIDO: gate quebrado por tipagem

`TitleBar.tsx` acessava `window.__TAURI_INTERNALS__` sem tipagem, quebrando
`tsc --build` (e por consequência `npm run build`, `typecheck`, `check` e
`api:test`). Trocado pelo helper oficial `isTauri()` de
`@tauri-apps/api/core`. Como o componente não tinha nenhum teste, foi criado
[`TitleBar.test.tsx`](apps/web/src/components/TitleBar.test.tsx) cobrindo o
comportamento fora e dentro do contexto Tauri (com os mocks oficiais
`@tauri-apps/api/mocks`), incluindo os três comandos IPC dos botões da
barra de título.

## Achado 2 — CORRIGIDO: identificador de bundle no padrão do template

`tauri.conf.json` tinha `"identifier": "com.tauri.dev"`, o que o Tauri
recusa para builds de release ("must be unique across applications"). Nunca
tinha existido um `.exe` de release de verdade — só um build de debug de uma
sessão `tauri dev` anterior. Corrigido para `com.respawn.desktop` (o Tauri
também avisou que um identificador terminado em `.app` conflita com a
extensão de bundle do macOS, então evitei esse sufixo).

## Achado 3 — CORRIGIDO: `frontendDist` apontava para o diretório errado

Depois de resolver o identificador, o primeiro `.exe` de release real
compilou e abriu uma janela — mas mostrando **tela preta com o texto "asset
not found: index.html"** em vez do login.

**Causa:** `apps/web/vite.config.ts` gera o build em `dist/client/`
(`build.outDir: "dist/client"`), mas `tauri.conf.json` tinha
`"frontendDist": "../dist"` — apontando para o diretório pai, que não contém
`index.html` diretamente.

**Correção:** `frontendDist` ajustado para `"../dist/client"`.

**Evidência visual após a correção:** screenshot real da janela do `.exe`
de release rodando (não do navegador) confirma a tela de login renderizando
corretamente, com a barra de título customizada no topo (sem chrome nativo
do Windows — `decorations: false` funcionando), branding Respawn, e os três
botões de janela (minimizar/maximizar/fechar) no canto superior direito,
exatamente como especificado no `task.md`.

## Achado 4 — CORRIGIDO: CORS bloqueava a origem do shell desktop

Mesmo com o `.exe` renderizando a UI, a aplicação desktop não conseguiria
autenticar, conversar ou entrar em canais de voz: o app fazia chamadas
relativas (`fetch("/api/...")`, `socket.io` sem URL) que, sem
`VITE_API_URL`, resolvem contra a própria origem do webview
(`http://tauri.localhost` no Windows) — não contra a API real.

Duas correções, comprovadas ao vivo, sem risco (testadas via HTTP puro, sem
automação do desktop compartilhado):

- **`apps/web/.env`** (novo arquivo, não versionado) com
  `VITE_API_URL=http://127.0.0.1:3001`, seguindo o procedimento que o
  próprio `README.md` já documentava para "API hospedada separadamente" —
  que é sempre o caso do shell desktop.
- **CORS multi-origem no backend**: `CORS_ORIGIN` em
  [`env.ts`](apps/api/src/config/env.ts) agora aceita uma lista separada por
  vírgulas (retrocompatível — um único valor continua funcionando como
  antes) e é propagada como array tanto para o `cors` do Express quanto para
  o CORS do Socket.IO, que já suportam array nativamente. `.env` e
  `.env.example` (raiz) atualizados para
  `CORS_ORIGIN=http://localhost:5173,http://tauri.localhost`.

**Evidência antes/depois (requisição HTTP real, com o servidor rodando):**
```
Origin: http://tauri.localhost
Antes:  Access-Control-Allow-Origin: http://localhost:5173   (mismatch → navegador bloqueia)
Depois: Access-Control-Allow-Origin: http://tauri.localhost  (permitido)
```

**Cobertura de regressão criada:**
- `env.test.ts`: 4 testes novos — origem padrão preservada, lista com
  espaços, lista vazia rejeitada, origem inválida na lista rejeitada.
- `auth.e2e.test.ts`: 1 teste novo end-to-end — sobe um servidor real com
  duas origens configuradas e confirma que cada uma é refletida
  corretamente e que uma terceira origem não listada não recebe o cabeçalho
  (ou seja, seria bloqueada pelo navegador).

## Gate completo (estado final desta rodada)

```
Prisma generate/validate: aprovado
Build (tsc --build + vite bundle):       aprovado
Typecheck (api, web, database, ui):      aprovado
API:      39/39 testes aprovados (34 → 39: +1 CORS e2e, +4 CORS unit)
Frontend: 186/186 testes aprovados (12 arquivos)
```

`.exe` de release: compila, empacota (`Respawn_0.1.0_x64_en-US.msi` e
`Respawn_0.1.0_x64-setup.exe`), abre janela e renderiza a tela de login
corretamente com a barra de título customizada.

## Achado 5 — EM ABERTO: permissões de câmera/microfone (verificação manual pendente)

Não há configuração específica de câmera/microfone no lado nativo além do
padrão do WebView2 (que no Windows já expõe seu próprio prompt de permissão
para `getUserMedia`, independente do sistema de ACL do Tauri). Isso é
plausível, mas só uma sessão real dentro do app confirma.

**Por que eu não terminei de validar isso sozinho:** ao tentar validar,
percebi que uma captura de tela minha acabou capturando a **sua janela do
VS Code**, não o app — ou seja, `SetForegroundWindow` não estava realmente
trazendo a janela do app para frente nesta máquina, o que significa que
automação de mouse/teclado às cegas correria o risco real de clicar/digitar
na sua sessão ativa em vez do app. Parei ali (nenhum clique ou tecla chegou
a ser enviado) e não tentei de novo.

**O que já está pronto para você testar em 1 minuto:** o `.exe`, a API, o
Postgres e o LiveKit local estão rodando agora. Existe uma conta de teste
descartável:
- Email: `qa-desktop-test@example.com`
- Senha: `SenhaSegura!123`

Basta abrir `C:\Users\migue\Desktop\Respawn\apps\web\src-tauri\target\release\app.exe`,
entrar com essas credenciais e testar um canal de voz — aí sim confirmando
se o prompt de permissão de câmera/microfone aparece e funciona de verdade.
Depois disso é só avisar que eu marco o item no `task.md`, atualizo este
relatório para APROVADA e removo a conta de teste.

## Higiene de QA

**Atualização (rollback):** com a Fase 4 removida do escopo, a conta de
teste `qa-desktop-test@example.com` foi removida do banco. Postgres, LiveKit
e a API local continuam rodando porque também servem a aplicação web (chat e
voz das Fases 2-3), não são específicos do desktop — ficam à disposição para
uso contínuo.
