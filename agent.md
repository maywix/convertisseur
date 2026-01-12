# Agentic Development Rules & Guidelines

## 1. Project Mandates
- **Core Stack**: Flask (Python) + Vanilla JS + CSS3.
- **Conversion Engine**: FFmpeg (Video/Audio), pypdf (PDF manipulation), Pillow (Images).
- **Architecture**:
  - No database required (stateless processing).
  - Use file system for temporary storage (`uploads/`, `processed/`) with auto-cleanup.
- **Git**: Commit messages must be concise and descriptive.

## 2. Functional Requirements (User Rules)
- **Batch Processing**:
  - The system MUST support unlimited file uploads.
  - Processing MUST be sequential (handled by client-side queue) to prevent server overload.
  - Each file in the batch follows the globally selected settings.
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

## 4. Git Workflow
- Repository: `https://github.com/maywix/convertisseur`
- `.gitignore` must exclude virtual environments, uploads, and processed files.
