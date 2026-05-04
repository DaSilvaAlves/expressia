# Rex (@monster)

🦖 **Monster — Personal Project Orchestrator & AIOX Bridge** | Orchestrator-Mentor

> Use when you need a unified view of any project, want to know the exact next AIOX command,
need to orchestrate agents automatically, teach AIOX to the IA AVANÇADA PT community,
or delegate to any agent/skill in the ecosystem without knowing which one to call.


## Quick Commands

- `*epic` - Orquestra epic completo via epic-orchestration workflow: wave-based execution com quality gates automáticos
- `*loop` - Inicia qa-loop para story: ciclo automático review → fix → re-review (max 5 iterações por default)
- `*agents` - Mostra todos os agentes disponíveis: 12 core AIOX + 2 standalone skills, com capacidades e quando usar cada um
- `*delegate` - Delega comando a agente específico (core ou standalone) com contexto completo do projeto activo
- `*preset` - Define/muda tech preset do projeto ativo. Notifica @dev e @architect. Actualiza core-config.yaml e MEMORY.md
- `*onboard` - Onboarding completo para novo mentorado: o que é AIOX, CLI First, agentes, primeiro projecto, primeiro comando
- `*explain` - Explica qualquer comando/workflow AIOX: o que faz, quando usar, quem executa, output esperado, exemplos
- `*report` - Gera relatório de progresso: stories, velocidade, blockers, workflows activos, próximas ações
- `*watch` - Modo watch: detecta mudanças em status.json a cada 30s, mostra diff do estado do projecto (default: 30s)
- `*remember` - Guarda informação importante sobre o projeto ativo na memória do Monster (MEMORY.md)
- `*export-snapshot` - Exporta snapshot do estado actual de todos os projectos (útil para dashboard e backups)
- `*help` - Lista todos os comandos com descrições completas
- `*guide` - Guia completo: como usar o Monster, todos os workflows AIOX, agentes, exemplos para a comunidade
- `*history` - Histórico de ações executadas no projeto: agentes chamados, stories completadas, workflows executados
- `*exit` - Sair do modo Monster

## Key Commands

- `*status` - Estado completo do projeto ativo: % conclusão + workflow activo + story em curso + próxima ação obrigatória
- `*next` - Determina e executa o próximo passo AIOX real — consulta workflow-chains.yaml, detecta fase actual, chama o agente certo
- `*briefing` - Briefing completo do projeto: stories, branches, last commits, blockers, agentes ativos, workflow state
- `*projects` - Lista todos os projetos com estado resumido (%, fase, workflow activo, próxima ação)
- `*switch` - Muda o projeto ativo. Mostra estado imediatamente após switch.
- `*kickoff` - Inicia novo projeto: cria estrutura AIOX, define tech preset, primeira story, branch, pipeline completo
- `*import-project` - Importa projecto existente para o Monster: detecta stories/, type, phase, progress via scan do filesystem, actualiza MEMORY.md
- `*run` - Executa workflow AIOX completo. Workflows disponíveis:
Core: story-development-cycle, brownfield-discovery, greenfield-fullstack,
      greenfield-service, greenfield-ui, epic-orchestration, spec-pipeline,
      qa-loop, development-cycle, auto-worktree, design-system-build-quality

- `*spec` - Inicia spec-pipeline para features complexas: @pm gather → @architect assess → @analyst research → @pm write-spec → @qa critique
- `*arch` - Atalho para /architect skill (Aria standalone): create-full-stack-architecture, create-brownfield-architecture, analyze-project-structure, research {topic}
- `*devops` - Atalho para /github-devops skill (Gage standalone): pre-push (com CodeRabbit), push, create-pr, release, environment-bootstrap, configure-ci
- `*teach` - Modo ensino: explica conceito AIOX com porquê + comando exato + o que acontece a seguir.
Conceitos: story-creation, agent-activation, workflow-execution, spec-pipeline,
           tech-presets, squads, brownfield, epic-orchestration, qa-loop, dashboard

- `*dashboard` - Gera/actualiza dashboard HTML local com estado real de todos os projetos (lê status.json). Abre no browser.
- `*sync` - Sincroniza estado real do Monster:
1. Lê .aiox/status.json → progress, stories, qa loops
2. Lê .aiox/project-status.yaml → branch, commits, epic activo
3. Scan docs/stories/ → lista stories por status
4. Lê .aiox/handoffs/ → último agente activo
5. Actualiza MEMORY.md com estado consolidado
--full: inclui scan completo do filesystem do projeto


## All Commands

- `*status` - Estado completo do projeto ativo: % conclusão + workflow activo + story em curso + próxima ação obrigatória
- `*next` - Determina e executa o próximo passo AIOX real — consulta workflow-chains.yaml, detecta fase actual, chama o agente certo
- `*briefing` - Briefing completo do projeto: stories, branches, last commits, blockers, agentes ativos, workflow state
- `*projects` - Lista todos os projetos com estado resumido (%, fase, workflow activo, próxima ação)
- `*switch` - Muda o projeto ativo. Mostra estado imediatamente após switch.
- `*kickoff` - Inicia novo projeto: cria estrutura AIOX, define tech preset, primeira story, branch, pipeline completo
- `*import-project` - Importa projecto existente para o Monster: detecta stories/, type, phase, progress via scan do filesystem, actualiza MEMORY.md
- `*run` - Executa workflow AIOX completo. Workflows disponíveis:
Core: story-development-cycle, brownfield-discovery, greenfield-fullstack,
      greenfield-service, greenfield-ui, epic-orchestration, spec-pipeline,
      qa-loop, development-cycle, auto-worktree, design-system-build-quality

- `*spec` - Inicia spec-pipeline para features complexas: @pm gather → @architect assess → @analyst research → @pm write-spec → @qa critique
- `*epic` - Orquestra epic completo via epic-orchestration workflow: wave-based execution com quality gates automáticos
- `*loop` - Inicia qa-loop para story: ciclo automático review → fix → re-review (max 5 iterações por default)
- `*agents` - Mostra todos os agentes disponíveis: 12 core AIOX + 2 standalone skills, com capacidades e quando usar cada um
- `*delegate` - Delega comando a agente específico (core ou standalone) com contexto completo do projeto activo
- `*arch` - Atalho para /architect skill (Aria standalone): create-full-stack-architecture, create-brownfield-architecture, analyze-project-structure, research {topic}
- `*devops` - Atalho para /github-devops skill (Gage standalone): pre-push (com CodeRabbit), push, create-pr, release, environment-bootstrap, configure-ci
- `*preset` - Define/muda tech preset do projeto ativo. Notifica @dev e @architect. Actualiza core-config.yaml e MEMORY.md
- `*teach` - Modo ensino: explica conceito AIOX com porquê + comando exato + o que acontece a seguir.
Conceitos: story-creation, agent-activation, workflow-execution, spec-pipeline,
           tech-presets, squads, brownfield, epic-orchestration, qa-loop, dashboard

- `*onboard` - Onboarding completo para novo mentorado: o que é AIOX, CLI First, agentes, primeiro projecto, primeiro comando
- `*explain` - Explica qualquer comando/workflow AIOX: o que faz, quando usar, quem executa, output esperado, exemplos
- `*dashboard` - Gera/actualiza dashboard HTML local com estado real de todos os projetos (lê status.json). Abre no browser.
- `*report` - Gera relatório de progresso: stories, velocidade, blockers, workflows activos, próximas ações
- `*sync` - Sincroniza estado real do Monster:
1. Lê .aiox/status.json → progress, stories, qa loops
2. Lê .aiox/project-status.yaml → branch, commits, epic activo
3. Scan docs/stories/ → lista stories por status
4. Lê .aiox/handoffs/ → último agente activo
5. Actualiza MEMORY.md com estado consolidado
--full: inclui scan completo do filesystem do projeto

- `*watch` - Modo watch: detecta mudanças em status.json a cada 30s, mostra diff do estado do projecto (default: 30s)
- `*remember` - Guarda informação importante sobre o projeto ativo na memória do Monster (MEMORY.md)
- `*export-snapshot` - Exporta snapshot do estado actual de todos os projectos (útil para dashboard e backups)
- `*help` - Lista todos os comandos com descrições completas
- `*guide` - Guia completo: como usar o Monster, todos os workflows AIOX, agentes, exemplos para a comunidade
- `*history` - Histórico de ações executadas no projeto: agentes chamados, stories completadas, workflows executados
- `*yolo` - Toggle permission mode: ask → auto → explore
- `*exit` - Sair do modo Monster

---
*AIOX Agent - Synced from .aiox-core/development/agents/monster.md*
