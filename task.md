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
- `[ ]` **Backend:** Configurar servidor WebSocket e garantir que apenas usuários logados conectem.
- `[ ]` **Integração:** Envio e recebimento imediato de mensagens na tela (sem precisar recarregar a página).
- `[ ]` **Refinamento de UX do Chat:** 
  - `[ ]` Agrupamento automático de mensagens enviadas sequencialmente pelo mesmo usuário.
  - `[ ]` Renderização básica de Markdown (negrito, itálico, código).
  - `[ ]` Rolagem infinita (buscar histórico de mensagens antigas ao dar scroll para cima).
  - `[ ]` O scroll deve sempre grudar na base automaticamente ao receber nova mensagem.
- `[ ]` **Sistema de Presença e Status:**
  - `[ ]` Indicador visual de "Online/Offline" na barra de membros.
  - `[ ]` Funcionalidade real-time: "Fulano está digitando...".

## Fase 3: Voz e Vídeo (Integração LiveKit WebRTC)
- `[ ]` Configurar um projeto no LiveKit Cloud (ou rodar um servidor LiveKit local em Docker) para os testes.
- `[ ]` **Backend:** Criar a mecânica para o servidor emitir Tokens de acesso seguros para as salas de voz.
- `[ ]` **Frontend (Canais de Voz):**
  - `[ ]` Modificar a UI do canal de voz para expandir mostrando a lista de usuários conectados dentro dele.
  - `[ ]` Painel flutuante de controle na parte inferior ("Voice Connected" / "Ping ms").
  - `[ ]` Controles vitais: Mutar Microfone e Ensurdecer Áudio.
  - `[ ]` Animação reativa: A borda do avatar deve piscar em verde quando detecta voz humana.
- `[ ]` **Frontend (Transmissão de Vídeo):**
  - `[ ]` Ligar/desligar webcam com permissões do navegador.
  - `[ ]` Botão de "Compartilhar Tela".
  - `[ ]` Grid visual para comportar até 6 vídeos simultâneos (1080p).

## Fase 4: A Aplicação Desktop Nativa (Tauri)
- `[ ]` Adicionar Tauri ao projeto web (`apps/web`).
- `[ ]` Customizar a barra superior do sistema operacional (Desligar o Window Chrome nativo e integrar os botões de fechar/minimizar na própria UI HTML/CSS).
- `[ ]` Configurar permissões de acesso ao microfone e câmera no binário nativo.
- `[ ]` Compilar e testar o executável (`.exe`) para Windows.

## Fase 5: Polimento e Funcionalidades Core Finais
- `[ ]` Sistema robusto de Menções (Digitar `@usuario` notifica o usuário específico).
- `[ ]` Implementar hierarquia básica de Cargos/Permissões no banco de dados (Novato, Player, Squadmate, Veteran, MVP, Elite, Mod, Admin).
- `[ ]` Estruturar canais padrão iniciais conforme o branding (Ex: `#spawn-point`, `#chat-geral`, `Lobby 1`, etc).
- `[x]` Adicionar Footer (Rodapé institucional) nas telas de Login e Registro (`AuthShell`).
- `[ ]` Revisão completa do código visando ganchos para futura integração com IAs (Ex: garantir que a API permita a injeção de uma mensagem gerada por script sem quebrar os websockets).
