# Agentic Development Rules & Guidelines

## 1. Project Mandates
- **Core Stack**: Flask (Python) + Vanilla JS + CSS3.
- **Conversion Engine**: FFmpeg (Video/Audio), pypdf (PDF manipulation), Pillow (Images), reportlab (generation pdf pour tests).
- **Architecture**:
  - jobs asynchrones persistants via sqlite (sans comptes utilisateur)
  - stockage temporaire sur disque:
    - `uploads/` pour input (supprime apres traitement)
    - `processed/` pour output (supprime apres expiration)
    - `data/jobs.sqlite3` pour l etat des jobs
  - retention: fichiers conserves 3h apres fin (`expires_at = done_at + 3h`), nettoyage periodique en thread daemon
- **Git**: Commit messages must be concise and descriptive.

## 2. Functional Requirements (User Rules)
- **Batch Processing**:
  - The system MUST support unlimited file uploads.
  - l ui peut envoyer en batch, le serveur gere des jobs et le navigateur peut fermer/revenir (cookie `session_id`)
  - les jobs peuvent s executer en parallele (pools globaux par type)
- **Conversion Logic**:
  - Auto-detection of input format.
  - Smart suggestion of output formats based on input type.
- **Compression Capabilities**:
  - **Video**:
    - *CRF Mode*: Quality-based (Low/Medium/High).
    - *Target Size*: User specifies desired file size in MB. (Requires bitrate calculation).
    - *Percentage*: User specifies reduction % (e.g., 50% smaller).
    - *Resolution*: User selects output resolution (1080p, 720p, 480p, 360p) with aspect ratio preservation.
  - **Audio**: Bitrate reduction.
  - **PDF**: Stream compression and metadata stripping.

## 3. Development Conventions
- **Code Style**: PEP 8 (Python), Standard JS.
- **Safety**:
  - Always validate filenames (`secure_filename`).
  - Never trust user input for shell commands (use array format for `subprocess`).
- **Pathing**: absolute paths only.

## 4. runtime api (flask)
- `GET /health`: infos de sante + cpu_threads + workers
- `POST /jobs`: cree un job (upload fichier + action/options)
- `GET /jobs`: liste des jobs de la session (cookie)
- `GET /jobs/<id>`: details d un job
- `GET /download/<id>`: telechargement du resultat (controle par session)

## 5. concurrence
- au demarrage: `cpu_threads = os.cpu_count() or 1`
- pools globaux:
  - video: 1 worker
  - audio: cpu_threads workers
  - image: max(1, cpu_threads//2) workers
  - pdf: max(1, cpu_threads//2) workers

## 6. tooling front (bun)
- build js vers `static/dist/`
- scripts:
  - `npm run build` (ou `bun run build`)
  - `npm run dev` (ou `bun run dev`)

## 7. tests
- smoke test api: `python3 scripts/smoke_test.py`
- test generation + conversions: `python3 test.py`
  - si ffmpeg absent: `python3 test.py --skip-ffmpeg`

## 8. dependances python
- requirements:
  - Flask==3.1.2
  - pypdf==6.6.0
  - Pillow==12.1.0
  - reportlab>=4.0.0

## 9. Git Workflow
- Repository: `https://github.com/maywix/convertisseur`
- `.gitignore` must exclude virtual environments, uploads, and processed files.
