# Convertisseur Studio

Convertisseur de médias auto-hébergé. Tu déposes des fichiers, tu choisis un format, tu récupères le résultat. Vidéo, audio, image, PDF, documents Office et modèles 3D dans une seule app web, plus un **Color Lab** pour étalonner vidéos et photos (LUT `.cube`, lumière, couleurs) avec un aperçu en direct.

Pensé pour tourner chez soi et être utilisé à distance via un **Cloudflare Tunnel**.

---

## Sommaire

- [L'interface](#linterface)
- [Où se fait la conversion](#où-se-fait-la-conversion)
- [Cloudflare Tunnel](#cloudflare-tunnel)
- [Color Lab](#color-lab)
- [Formats compatibles](#formats-compatibles)
- [Démarrage](#démarrage)
- [Commandes de gestion](#commandes-de-gestion)
- [Options de configuration](#options-de-configuration)
- [Architecture](#architecture)
- [Tests](#tests)

---

## L'interface

Même style que Eclypse Downloader : fond noir, une colonne, onglets en haut, badge d'état du serveur en bas à droite. Deux espaces, **Convertir** et **Color Lab · étalonnage**, qui partagent la même liste de fichiers.

| Espace | Ce qu'on y fait |
|---|---|
| **Convertir** | Déposer des fichiers (ou des dossiers entiers, ou Ctrl+V), choisir le format par type ou fichier par fichier, régler les options, cliquer sur **Convertir**. |
| **Color Lab** | Étalonner vidéos et photos : LUT, lumière, couleur, roues chromatiques, effets, détourage, découpe, texte. Aperçu en direct, export fichier par fichier ou en lot. |

On peut glisser des fichiers n'importe où sur la page. Chaque fichier a son menu **« en [format] »** sur sa ligne. En dessous, la carte **Paramètres de conversion** est organisée comme un convertisseur classique : une section par type (Format de sortie, Vidéo, GIF, Images, Son, Découper), chaque réglage étant un **menu déroulant**. Seules les sections utiles aux fichiers présents s'affichent.

**Réglages d'un seul fichier** : le bouton ⚙ d'une ligne ouvre ses propres réglages (format, qualité, résolution…). Le fichier est marqué « Réglages perso » ; « Revenir aux réglages communs » annule.

Tous les paramètres du serveur sont accessibles dans ces menus :

- **Vidéo** : qualité (préréglage, poids cible, réduction en %, CRF, débit fixe en 1 ou 2 passes), résolution max ou taille exacte, codec (H.264, H.265, VP9, AV1), images/s, rotation / miroir, piste son (garder, copier sans réencoder, supprimer). Les vidéos HDR (iPhone…) sont ramenées en SDR automatiquement pour ne pas sortir grises. On peut aussi extraire le son d'une vidéo (MP3, M4A, WAV…).
- **Plus d'options vidéo** (bloc repliable, avec le nombre de réglages actifs et un bouton pour tout remettre par défaut) : preset, tune, profil, format de pixels, débruitage, HDR → SDR, désentrelacement, rognage, texte incrusté avec position.
- **Son** : débit, fréquence, mono / stéréo, volume en dB ou normalisation.
- **GIF** : largeur, images/s, vitesse, 8 à 256 couleurs, tramage, lecture en boucle / une fois / N fois.
- **Images** : qualité, taille max en px ou en %, agrandissement, poids cible en Mo, WebP sans perte, taille des icônes ICO, diaporama.
- **Découper** : début / fin pour vidéos, GIF et sons.
- Un bouton **Journal** sur chaque fichier affiche la commande FFmpeg exécutée et ses messages. Une barre de progression globale suit le lot en cours.

**Téléchargements** : bouton vert **Sauvegarder** par fichier, et **Tout sauvegarder** pour le lot, au choix en **un ZIP** ou en **fichiers séparés** (Réglages). Quand on dépose un dossier, le ZIP **garde l'arborescence** (dossiers et sous-dossiers), que la conversion se soit faite sur le serveur ou dans le navigateur. Option « Télécharger automatiquement à la fin ».

**Arrière-plan** (activé par défaut) : les conversions serveur continuent si on ferme l'onglet, et la liste revient au rechargement de la page. Désactivé, la page prévient avant de se fermer et ne restaure rien. Les fichiers sont supprimés du serveur automatiquement après 3 h.

Le menu **Réglages** (roue dentée) regroupe : où convertir, téléchargement auto, ZIP / fichiers séparés, arrière-plan, limite de débit via le tunnel et thème (sombre par défaut, clair, système).

---

## Où se fait la conversion

| Réglage | Comportement |
|---|---|
| **Auto** (par défaut) | Les images que le navigateur sait lire (JPG, PNG, WebP, AVIF, BMP) sont converties **sur l'appareil**, rien n'est envoyé. Tout le reste va au serveur. |
| **Serveur** | Tout passe par le serveur (FFmpeg, Pillow, LibreOffice). Le plus fiable. |
| **Navigateur** | Essaie aussi les vidéos dans le navigateur avec ffmpeg.wasm (fichiers < 700 Mo). Utile pour éviter d'envoyer de grosses vidéos via un tunnel lent. |

Si un traitement dans le navigateur échoue (format que le navigateur ne sait pas encoder, fichier trop gros…), l'app **bascule automatiquement sur le serveur**. Un résultat vide n'est jamais proposé au téléchargement, ni côté navigateur ni côté serveur.

Le moteur ffmpeg.wasm (~32 Mo) est servi par ton propre serveur, sans CDN externe, et n'est téléchargé que si le mode Navigateur est utilisé.

---

## Cloudflare Tunnel

Le serveur détecte automatiquement les connexions qui passent par un tunnel Cloudflare (en-têtes `CF-Connecting-IP` / `CF-Ray`). Dans ce cas :

- **Envois découpés** en morceaux de 8 Mo maximum. Cloudflare refuse les requêtes de plus de 100 Mo : c'est ce qui faisait échouer les gros fichiers.
- **Reprise automatique** : si la connexion saute, l'envoi reprend là où il s'était arrêté.
- **Débit limité** à 5 Mo/s par défaut, à l'envoi comme au téléchargement. Réglable dans *Réglages → Tunnel Cloudflare* (1 à 50 Mo/s, ou illimité), ou côté serveur avec `TUNNEL_RATE_LIMIT_MBPS`.
- **Téléchargements reprenables** (requêtes `Range`) et **ZIP envoyé en streaming**, pour ne plus tomber sur les erreurs 524 de Cloudflare sur les gros lots.
- Le badge en bas à droite affiche **Tunnel Cloudflare · 5 Mo/s**.

En accès direct (réseau local, `localhost`), aucune limite n'est appliquée.

---

## Color Lab

- **LUT `.cube`** : un LUT pour tous les fichiers, ou un par fichier. Les LUT exportés par DaVinci Resolve (`LUT_3D_INPUT_RANGE`, BOM, fins de ligne Windows) sont acceptés : ils sont réécrits dans un format que FFmpeg comprend. Un LUT invalide ou 1D est signalé clairement.
- **Réglages** : exposition, contraste, hautes lumières, ombres, blancs, noirs, température, teinte, saturation, rotation de teinte, roues Lift / Gamma / Gain, netteté, vignette, grain, glow, aberration chromatique, détourage d'une couleur (fond vert).
- **Aperçu en direct** sur les vidéos (lecture, scrub) et sur les photos, LUT compris. Bouton **Avant / après** à maintenir pour voir l'original.
- **Sur tous** : applique le look du fichier courant à tous les fichiers.
- **Export** : MP4 (H.264), MOV, WebM, MKV, GIF pour les vidéos ; JPG, PNG, WebP, AVIF, TIFF pour les images. Pour les vidéos : images/s, découpe (avec « position actuelle ») et texte incrusté.
- **Exporter en …** lance le rendu puis **télécharge le fichier tout seul** à la fin. Tant que les réglages ne bougent pas, le bouton devient **Télécharger** (pas de nouveau rendu) avec **Refaire** à côté ; dès qu'un réglage change, il repasse en **Exporter**. « Tout exporter » rend les fichiers pas encore exportés et les télécharge en ZIP ou séparément selon les réglages.
- Les vidéos exportées sont toujours en **H.264 / yuv420p + faststart**, lisibles partout (navigateurs, iPhone, QuickTime, Windows). Avant, un LUT produisait du H.264 4:4:4 que la plupart des lecteurs refusaient.
- Les photos lisibles par le navigateur sont exportées sur place avec **exactement** le même rendu que l'aperçu. Les autres (HEIC, RAW) passent par le serveur, LUT compris.

Navigation entre fichiers : ← / → ou la bande de miniatures sous l'aperçu.

---

## Formats compatibles

### Vidéo

**Entrée** : mp4, mov, avi, mkv, webm, wmv, flv, m4v, mpeg, mpg, 3gp, 3g2, ts, mts, m2ts, vob, ogv, divx, xvid, asf, rm, rmvb, f4v

**Sortie** : mp4, webm, mkv, mov, avi, m4v, wmv, flv, mpeg, ogv, ts, gif, son seul (mp3, m4a, wav, flac, ogg, opus), images PNG (zip)

### Audio

**Entrée** : mp3, wav, m4a, flac, aac, ogg, wma, aiff, aif, opus, ac3, eac3, dts, amr, ape, mka, mpa, au, ra, mid, midi

**Sortie** : mp3, m4a, aac, wav, flac, ogg, opus, aiff, wma, ac3

### Image

**Entrée** : png, jpg, jpeg, gif, tiff, tif, bmp, psd, heic, heif, webp, avif, ico, jp2, j2k, jpf, jpm, raw, cr2, nef, arw, dng, orf, rw2, pef, tga, sgi, qtif, pict, icns, svg

**Sortie** : jpg, png, webp, avif, gif, bmp, tiff, ico, pdf

### PDF

**Sortie** : PDF compressé, texte (txt)

### Documents Office

**Entrée** : docx, doc, odt, rtf, xlsx, xls, ods, csv, pptx, ppt, odp → **PDF** (LibreOffice headless)

### Modèles 3D

**Entrée et sortie** : obj, stl, ply, glb, gltf (entrée), 3mf, off

---

## Démarrage

### Pré-requis

- Docker
- Node.js 20+ ou Bun (pour construire l'interface)

### Première installation

```bash
git clone <repo-url> convertisseur
cd convertisseur
./scripts/manage.sh full
```

`full` télécharge les dépendances, construit l'interface puis l'image Docker sans cache, et démarre le conteneur. FFmpeg vient maintenant du paquet Debian (plus de compilation) : le build prend quelques minutes au lieu de 30 à 45.

L'application est ensuite disponible sur **http://localhost:6060**. Pour y accéder de l'extérieur, fais pointer ton tunnel Cloudflare vers `http://localhost:6060`.

### Lancements suivants

```bash
./scripts/manage.sh up
```

Reconstruit seulement ce qui a changé et redémarre.

### Mettre à jour

```bash
git pull            # ou : git fetch && git checkout <branche>
./scripts/manage.sh up
```

Le script affiche la branche et la version (commit) déployées, et la même version apparaît en bas du menu **Réglages** de l'app. Si l'app n'a pas changé après une mise à jour :

- `git status` : des modifications locales peuvent empêcher `git checkout` / `git pull` de changer de version. Mets-les de côté avec `git stash -u`, puis recommence.
- Le script s'arrête avec un message si le port 6060 est déjà pris par un autre conteneur (par exemple un ancien lancé avec `docker compose`) : arrête-le, puis relance.
- En cas d'erreur de build, l'ancienne version reste en ligne : regarde la fin de `scripts/manage.log`.

---

## Commandes de gestion

Tout passe par `scripts/manage.sh`.

| Commande | Ce qu'elle fait |
|---|---|
| `download` | Pull l'image Docker de base + installe les dépendances du frontend. Ne touche pas au conteneur. |
| `up` *(ou `fast`)* | Reconstruit ce qui a changé et redémarre. À utiliser au quotidien. |
| `full` | **download** + reconstruction complète sans cache. |
| `rebuild` | Reconstruction complète sans cache, sans retélécharger. |
| `restart` | Redémarre le conteneur, sans rebuild. |
| `maintenance` | Redémarre, nettoie le cache Docker et les fichiers temporaires. |
| `stop` | Arrête et supprime le conteneur. |
| `logs` | Affiche les logs en direct. |
| `status` | État du conteneur + health check. |
| `install-cron` / `uninstall-cron` | Maintenance automatique tous les 4 jours à 4 h. |

Toutes les actions sont enregistrées dans `scripts/manage.log`.

---

## Options de configuration

À définir dans `docker-compose.yml` ou en variables d'environnement (`TUNNEL_MODE=on ./scripts/manage.sh up` par exemple).

| Variable | Défaut | Description |
|---|---:|---|
| `RETENTION_SECONDS` | `10800` | Durée de conservation des fichiers convertis (3 h). |
| `CLEANUP_INTERVAL_SECONDS` | `300` | Fréquence du nettoyage automatique. |
| `MAX_ENQUEUED_JOBS` | `50` | Nombre maximum de conversions en attente par visiteur. |
| `TUNNEL_MODE` | `auto` | `auto` : détecte Cloudflare Tunnel via ses en-têtes. `on` : considère toujours qu'on passe par le tunnel. `off` : jamais. |
| `TUNNEL_RATE_LIMIT_MBPS` | `5` | Débit par défaut (Mo/s) proposé aux navigateurs qui passent par le tunnel. Chacun peut le changer dans ses Réglages. |
| `VIDEO_STALL_TIMEOUT` | `600` | Une conversion qui n'avance plus pendant ce temps (s) est arrêtée. Les longues vidéos 4K / HDR ne sont plus coupées tant qu'elles progressent. |
| `VIDEO_PROC_TIMEOUT` | `21600` | Durée max absolue (s) d'une conversion vidéo / audio. |
| `LOG_LEVEL` | `INFO` | DEBUG, INFO, WARNING, ERROR. |

---

## Architecture

**Backend** : Flask + gunicorn (1 process, 16 threads), SQLite, un pool de threads par type de média.

- FFmpeg (paquet Debian : x264, x265, VP9, AV1, Opus, Vorbis, zscale, drawtext)
- Pillow + pillow-heif + rawpy + cairosvg pour les images, numpy pour appliquer les LUT aux photos
- pypdf, LibreOffice headless, trimesh
- Uploads découpés et reprenables (`/uploads`), jobs (`/jobs`), téléchargements avec `Range` et limite de débit optionnelle (`?rate=`), ZIP en streaming (`/download-all?ids=`), config (`/api/config`)

**Frontend** : React 19, Vite, Tailwind 4, sans bibliothèque de composants.

- `hooks/useQueue.ts` : la liste de fichiers et le moteur (un envoi à la fois, repli navigateur → serveur, suivi des jobs, restauration après rechargement, téléchargements)
- `lib/api.ts` : envoi découpé avec reprise et limite de débit
- `lib/convertPlan.ts` : choix navigateur / serveur et paramètres de chaque conversion
- `lib/lutCanvas2D.ts` : pipeline d'étalonnage partagé entre l'aperçu vidéo, l'aperçu photo et l'export photo
- `lib/clientVideoProcessor.ts` : ffmpeg.wasm (mode Navigateur)
- `components/ConvertPage.tsx`, `components/ColorLab.tsx` : les deux espaces (le Color Lab est chargé à la demande)

---

## Tests

```bash
pip install -r requirements.txt pytest
python -m pytest tests -q
```

Les tests lancent de vraies conversions FFmpeg (ignorées si FFmpeg n'est pas installé) : LUT Resolve, lecture du H.264 exporté, envois découpés et reprise, limite de débit, ZIP, noms de fichiers accentués…

Côté frontend : `bun run build` (type-check + build) et `bun run lint`.

---

## Licence

Projet personnel. Code fourni en l'état, sans garantie. Usage non commercial.
