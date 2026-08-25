# Lista de Tarefas - Projeto "Respawn"

Este é o plano de ação rigoroso, dividido em domínios de escopo fechado. Uma funcionalidade não avança até que todos os detalhes e critérios de aceite da etapa atual estejam concluídos.

- `[ ]` Tarefa pendente
- `[/]` Tarefa em progresso
- `[x]` Tarefa concluída

## Fase 1: Fundação, UI Base e Autenticação
- `[x]` Configurar estrutura do Monorepo (Node.js, NPM workspaces ou Turborepo).
- `[x]` Configurar banco de dados (PostgreSQL) localmente e definir o schema base no Prisma.
- `[x]` **Backend:** Criar sistema seguro de Registro, Login e Sessões.
- `[x]` **Frontend:** Criar as páginas de Login e Registro aplicando a identidade visual e cores da marca Respawn (verde neon, grafite escuro, etc).
- `[x]` **Frontend (Layout Principal):**
  - `[x]` Barra lateral esquerda (Lista de Servidores).
  - `[x]` Barra lateral secundária (Lista de Canais de texto e voz).
  - `[x]` Área central do Chat (com campo de input de texto no rodapé).
  - `[x]` Painel de Membros à direita.
- `[x]` **Frontend:** Criar navegação simulada (clicar nos canais altera a URL e a tela central de forma fluida).

## Fase 2: O Motor de Chat e Tempo Real (WebSockets)

> **Status: concluída e aprovada em revalidação de QA (24/08/2026).** O gate
> integral passou com build, typecheck, Prisma, 23/23 testes da API e 45/45
> testes web. A validação funcional com duas sessões reais confirmou mensagem
> em tempo real, Markdown, presença/typing, reconexão e resync, falha offline
> sem replay tardio, logout com revogação e layout móvel. Evidências detalhadas
> em `QA_FASE_2_CHAT_WEBSOCKETS.md`.

- `[x]` **Backend:** Configurar servidor WebSocket e garantir que apenas usuários logados conectem.
- `[x]` **Integração:** Envio e recebimento imediato de mensagens na tela (sem precisar recarregar a página).
- `[x]` **Refinamento de UX do Chat:**
  - `[x]` Agrupamento automático de mensagens enviadas sequencialmente pelo mesmo usuário.
  - `[x]` Renderização básica de Markdown (negrito, itálico, código).
  - `[x]` Rolagem infinita (buscar histórico de mensagens antigas ao dar scroll para cima).
  - `[x]` Scroll gruda na base ao receber mensagem própria, ou mensagem de terceiros quando já se está perto da base; caso contrário mostra um indicador "N novas mensagens" para o usuário decidir se quer descer.
- `[x]` **Sistema de Presença e Status:**
  - `[x]` Indicador visual de "Online/Offline" na barra de membros.
  - `[x]` Funcionalidade real-time: "Fulano está digitando...".

## Fase 3: Voz e Vídeo (Integração LiveKit WebRTC)
- `[x]` Configurar um projeto no LiveKit Cloud (ou rodar um servidor LiveKit local em Docker) para os testes.
- `[x]` **Backend:** Criar a mecânica para o servidor emitir Tokens de acesso seguros para as salas de voz.
- `[x]` **Frontend (Canais de Voz):**
  - `[x]` Modificar a UI do canal de voz para expandir mostrando a lista de usuários conectados dentro dele.
  - `[x]` Painel flutuante de controle na parte inferior ("Voice Connected" / "Ping ms").
  - `[x]` Controles vitais: Mutar Microfone e Ensurdecer Áudio.
  - `[x]` Animação reativa: A borda do avatar deve piscar em verde quando detecta voz humana.
- `[x]` **Frontend (Transmissão de Vídeo):**
  - `[x]` Ligar/desligar webcam com permissões do navegador.
  - `[x]` Botão de "Compartilhar Tela".
  - `[x]` Antes de iniciar o compartilhamento, permitir selecionar explicitamente um dos presets: **720p/30 FPS**, **720p/60 FPS**, **1080p/30 FPS** ou **1080p/60 FPS**.
  - `[x]` Disponibilizar a taxa da fonte/captura em **30 FPS** ou **60 FPS** e garantir que a escolha seja aplicada ao track publicado, não apenas exibida na UI.
  - `[x]` Encaminhar resolução e FPS selecionados para a captura/publicação do LiveKit, preservando a escolha durante a sessão de compartilhamento.
  - `[x]` Criar testes automatizados para o mapeamento e a aplicação de cada preset, incluindo cancelamento da seleção da fonte, permissão negada e encerramento/cleanup do compartilhamento.
  - `[x]` Grid visual para comportar até 6 vídeos simultâneos (1080p).

## Fase 4: A Aplicação Desktop Nativa (Tauri) — REMOVIDA DO ESCOPO

> **Status: removida do escopo por decisão do usuário (24/08/2026).** A
> integração com Tauri chegou a ser implementada e validada (build, testes
> automatizados, `.exe` de release compilando e rodando com a tela de login
> funcional). O usuário decidiu não seguir com o wrapper desktop — achou a
> experiência instável e prefere não manter uma stack (Rust/Tauri) fora do
> seu domínio de conhecimento — e optou por manter a aplicação apenas como
> web, com os mesmos requisitos das demais fases. Todo o código específico de
> desktop foi revertido nesta mesma sessão: `apps/web/src-tauri/`,
> `TitleBar.tsx`, o wrapper em `main.tsx`, as dependências `@tauri-apps/*` e o
> suporte a múltiplas origens de CORS que só existia para o shell desktop.
> O histórico da tentativa (achados, correções, evidências) fica registrado
> em `QA_FASE_4_DESKTOP_TAURI.md`, para referência caso o desktop volte a ser
> considerado no futuro. Nenhum item desta fase é mais um requisito do
> projeto.

## Fase 5: Deploy e Lançamento em Beta Fechada (Ato 1)

> **Contexto (24/08/2026):** Fases 1-3 aprovadas, Fase 4 (desktop) removida do
> escopo. Decisão do usuário: a próxima prioridade é colocar a versão web no
> ar para uma **beta fechada** — poucos usuários de confiança, convidados
> diretamente, não um público aberto/desconhecido. Por isso, itens de
> hardening que só importam para público aberto (recuperação de senha,
> verificação de email, rate limiting, moderação, páginas reais de
> Termos/Privacidade) **não bloqueiam** este ato e ficam adiados para a
> Fase 6 (Ato 2 — beta aberta). O escopo abaixo é o mínimo para ter a
> aplicação já validada (Fases 1-3) rodando fora do ambiente local, acessível
> aos convidados da beta.

- `[ ]` Provisionar infraestrutura de produção: ambiente Linux conteinerizado
  (Docker), conforme já discutido no `implementation_plan.md` (Oracle Cloud
  São Paulo ou Vultr).
- `[ ]` Configurar PostgreSQL de produção (gerenciado ou containerizado),
  fora do container local de desenvolvimento.
- `[ ]` Configurar LiveKit de produção (Cloud ou self-hosted) com `wss://` —
  a API já recusa `ws://` fora de `NODE_ENV=development`.
- `[ ]` Gerar segredos de produção próprios (`JWT_SECRET`,
  `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET`, credenciais do Postgres) — nunca
  reaproveitar os valores de desenvolvimento local do `.env`.
- `[ ]` Registrar domínio e configurar HTTPS/TLS.
- `[ ]` Ajustar `CORS_ORIGIN` para a origem pública de produção.
- `[ ]` Definir e documentar o processo de deploy (build + start em
  produção, reinício automático em caso de queda do processo/container).
- `[ ]` Validar o fluxo completo (registro, login, chat em tempo real, voz e
  vídeo) rodando na infraestrutura de produção, com pelo menos dois
  convidados reais da beta em sessões simultâneas.
- `[ ]` Definir e comunicar aos convidados o processo de convite/acesso à
  beta fechada (ex.: lista de emails liberados, ou apenas o link
  compartilhado discretamente — a decidir).

## Fase 6: Polimento e Funcionalidades Core Finais (Ato 2 — beta aberta)

> Itens desta fase não bloqueiam a beta fechada (Fase 5). Ficam para depois
> do primeiro deploy, antes de abrir a aplicação para um público mais amplo.

- `[ ]` Sistema robusto de Menções (Digitar `@usuario` notifica o usuário específico).
- `[ ]` Implementar hierarquia básica de Cargos/Permissões no banco de dados (Novato, Player, Squadmate, Veteran, MVP, Elite, Mod, Admin).
- `[ ]` Estruturar canais padrão iniciais conforme o branding (Ex: `#spawn-point`, `#chat-geral`, `Lobby 1`, etc).
- `[x]` Adicionar Footer (Rodapé institucional) nas telas de Login e Registro (`AuthShell`).
- `[ ]` Revisão completa do código visando ganchos para futura integração com IAs (Ex: garantir que a API permita a injeção de uma mensagem gerada por script sem quebrar os websockets).
- `[ ]` Validação dos testes automatizados.
- `[ ]` Recuperação de senha (fluxo "esqueci minha senha") e verificação de email.
- `[ ]` Rate limiting e proteção anti-abuso na API (registro, login, envio de mensagens).
- `[ ]` Ferramentas básicas de moderação (silenciar, banir, apagar mensagem de terceiros) usando a hierarquia de cargos acima.
- `[ ]` Páginas reais de Termos, Privacidade e Suporte (hoje o rodapé do `AuthShell` aponta para âncoras `#termos`/`#privacidade`/`#suporte` sem conteúdo).
