# Convertisseur Studio

Convertisseur de médias auto-hébergé. Tu déposes des fichiers, tu choisis un format ou un mode de compression, et tu récupères le résultat. Vidéo, audio, image, documents Office et modèles 3D, le tout dans une seule app accessible depuis un navigateur — et désormais avec un mode **Color Lab** pour étalonner image et vidéo en live + un mode **Frontend** qui convertit certains fichiers entièrement dans le navigateur sans rien envoyer au serveur.

> **Statut : en reconstruction continue.** L'interface évolue régulièrement, l'API change encore.

---

## Sommaire

- [Trois modes d'utilisation](#trois-modes-dutilisation)
- [Backend ou Frontend ?](#backend-ou-frontend-)
- [Ce que ça fait](#ce-que-ça-fait)
- [Color Lab](#color-lab)
- [Formats compatibles](#formats-compatibles)
- [Démarrage](#démarrage)
- [Commandes de gestion](#commandes-de-gestion)
- [Maintenance automatique](#maintenance-automatique)
- [Options de configuration](#options-de-configuration)
- [Architecture rapide](#architecture-rapide)

---

## Trois modes d'utilisation

L'interface bascule entre trois modes via le toggle en haut à droite :

| Mode | Pour qui | Ce que tu y trouves |
|---|---|---|
| **Simple** | Tout le monde | Tab strip de workflows (Auto, Vidéo → MP4, GIF Maker, Audio → MP3, Image → JPG/PNG/WebP, Compresser), gros bouton Convertir. Zéro réglage à connaître. |
| **Pro** | Pouvoir tout régler | Étapes numérotées (Action / Type / Format / Options) avec onglets Encoder · Transformer · Audio · Effets selon le type de média. |
| **Color Lab** | Étalonnage couleur | Workspace dédié multi-fichiers avec preview live, sliders type Lightroom + DaVinci, LUT, montage léger. |

---

## Backend ou Frontend ?

À côté des trois modes, un **toggle Front / Back** dans le header décide *où* se passe la conversion :

- **Frontend** (par défaut) : les images compatibles sont traitées **dans le navigateur** via Canvas + libs JS. Aucun upload, aucun CPU serveur. Les vidéos compatibles passent par **ffmpeg.wasm** (~30 MB de WASM téléchargés et cachés à la première utilisation).
- **Backend** : tout part au serveur Flask, qui pilote FFmpeg natif, Pillow, LibreOffice, etc. Plus puissant, plus de formats supportés.

Le badge **LOCAL** s'affiche dans la file d'attente sur les items traités côté navigateur. Le routage est automatique : si le navigateur ne peut pas faire un job (codec exotique, format de sortie non supporté, LUT côté vidéo, etc.), il bascule sur le backend silencieusement.

### Ce que sait faire le mode Frontend

| Type d'entrée | Sortie supportées en local |
|---|---|
| Image (jpg, png, webp, avif, heic…) | png, jpg, webp, avif, **bmp, ico, tiff, gif, pdf** |
| Vidéo (mp4, mov, webm, mkv…) | mp4, webm, mov, mkv, m4v, avi, gif (via ffmpeg.wasm) |
| LUT `.cube` | Parsing + interpolation trilinéaire en JS, applicable à l'image ou à la vidéo |

Tout le reste (audio, Office, 3D, formats exotiques) reste sur le backend.

---

## Ce que ça fait

**Conversion** entre tous les formats listés plus bas.

**Compression** avec quatre modes :
- Qualité automatique (low / medium / high)
- Taille cible en mégaoctets
- Pourcentage de réduction
- Résolution maximale

**Convert + compress** en une seule passe.

**Édition vidéo légère**
- Trim (début / fin)
- Rogner les bords
- Rotation et miroir
- Débruitage
- Conversion HDR vers SDR
- Texte incrusté
- Application d'un LUT colorimétrique `.cube`

**Étalonnage couleur** (voir section Color Lab plus bas)
- Tous les sliders style Lightroom (exposition, contraste, hautes lumières, ombres, blancs, noirs, saturation, température, teinte, hue, netteté)
- Color Wheels DaVinci (Lift / Gamma / Gain par zone tonale)
- Effets : vignette, glow, grain film, aberration chromatique
- LUT `.cube` avec deux modes : global (un LUT pour tous les fichiers) ou par-fichier
- Retirer une couleur (chroma key) avec tolérance ajustable

**Image upscaler** (Lanczos x2 / x3 / x4) en mode Pro.

**Slider FPS** en Color Lab : de 1 jusqu'au FPS natif détecté de la vidéo.

**Audio**
- Changement de codec et de bitrate
- Normalisation EBU R128
- Gain en décibels
- Suppression complète de la piste audio d'une vidéo

**GIF animés**
- Palette adaptative
- Dithering Sierra / Floyd-Steinberg / Bayer
- Contrôle vitesse, FPS, boucle

**Lots et séquences**
- Upload illimité
- Plusieurs jobs en parallèle
- Multi-fichiers avec navigation flèches en Color Lab (← / →)
- Tu peux fermer le navigateur et revenir plus tard, les jobs continuent
- Suite d'images vers vidéo
- Vidéo vers suite d'images PNG (export ZIP)

**Téléchargement** individuel, ZIP global ou bouton "Tout télécharger".

---

## Color Lab

Un workspace dédié à l'étalonnage couleur. Layout :

```
┌──────────────────────────────────┐ ┌──────────────┐
│  Preview vidéo / image           │ │ File queue   │
│  (avec preview live des effets)  │ │ (multi-files)│
└──────────────────────────────────┘ └──────────────┘

       [←]    Lancer le traitement    [→]
       Fichier 1/N — flèches ← →

[Format de sortie] MP4 MOV WEBM ...

Paramètres                                     Reset
┌─────────┐ ┌─────────┐ ┌─────────┐
│ Lumière │ │ Couleur │ │ Wheels  │
└─────────┘ └─────────┘ └─────────┘
┌─────────┐ ┌─────────┐ ┌─────────┐
│ Détail  │ │ Effets  │ │ Compress│
└─────────┘ └─────────┘ └─────────┘
┌─────────┐ ┌─────────┐
│ Remover │ │ LUT     │
└─────────┘ └─────────┘
┌────────────────────────────────────┐
│ Avancé : trim + texte incrusté     │
└────────────────────────────────────┘
```

### Preview live
- **Image** : `<img>` + filtre CSS pour les sliders qui s'expriment en CSS, sinon rendu Canvas
- **Vidéo** : Canvas 2D qui pull les frames du `<video>` et applique le pipeline complet (LUT + 12 effets) pixel par pixel. Tu vois en temps réel le résultat de chaque slider, y compris la température, les Color Wheels, le grain, l'aberration chromatique, etc.
- **Codec non supporté par le navigateur** (Apple Log, ProRes…) : message clair, fallback sur le backend pour le rendu final

### LUT `.cube`
- Importé via un file picker
- Toggle entre **global** (un seul LUT pour toutes les vidéos importées) ou **par fichier**
- Parsing + trilinear interpolation en JS pour la preview
- Côté export : filtre FFmpeg `lut3d` (backend ou ffmpeg.wasm)

### Multi-fichiers
- Drop plusieurs vidéos d'un coup
- Chaque fichier garde son propre état d'étalonnage (sliders, LUT si scope=per-file, FPS, trim, etc.)
- Navigation par boutons ← / → autour du bouton Lancer
- Liste des fichiers cliquable à droite de la preview

### Montage léger (section Avancé)
- Trim début / fin (formats `HH:MM:SS` ou secondes)
- Texte incrusté avec positions X / Y (expression FFmpeg type `(w-text_w)/2` acceptée)

---

## Formats compatibles

### Vidéo

**Entrée** : mp4, mov, avi, mkv, webm, wmv, flv, m4v, mpeg, mpg, 3gp, 3g2, ts, mts, m2ts, vob, ogv, divx, xvid, asf, rm, rmvb, f4v, mxf, dv, tod, nsv, amv

**Sortie** : mp4, webm, mkv, mov, avi, wmv, flv, m4v, mpeg, mpg, ogv, gif, ts, zip (suite PNG)

### Audio

**Entrée** : mp3, wav, m4a, flac, aac, ogg, wma, aiff, aif, opus, ac3, dts, amr, ape, mka, mpa, au, ra, mid, midi, eac3, tta, spx, wv, aifc

**Sortie** : mp3, aac, m4a, opus, ogg, flac, wav, wma, ac3, eac3, aiff

### Image

**Entrée** : png, jpg, jpeg, gif, tiff, tif, bmp, psd, heic, heif, webp, ico, jp2, j2k, jpf, jpm, raw, cr2, nef, arw, dng, orf, rw2, pef, tga, sgi, qtif, pict, icns, avif, jxl, ppm, pgm, pbm, pnm, svg

**Sortie** : png, jpg, jpeg, gif, webp, avif, bmp, tiff, ico, pdf

### Documents Office

**Entrée** : docx, doc, odt, rtf, xlsx, xls, ods, csv, pptx, ppt, odp

**Sortie** : pdf (via LibreOffice headless)

### Modèles 3D

**Entrée et sortie** : obj, stl, ply, glb, gltf, 3mf, off

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

`full` fait dans cet ordre :
1. **Download** : pull des images Docker de base + `npm install` (ou `bun install`)
2. Rebuild frontend
3. Prune Docker + clear caches projet
4. Rebuild Docker `--no-cache`
5. Restart conteneur

Le premier lancement prend **30 à 45 minutes** car FFmpeg est compilé depuis les sources pour avoir un binaire optimisé.

L'application est ensuite disponible sur **http://localhost:6060**.

### Lancements suivants

```bash
./scripts/manage.sh up
```

Construit uniquement ce qui a changé et redémarre le conteneur. Beaucoup plus rapide qu'un `full`.

### Pré-télécharger sans tout casser

```bash
./scripts/manage.sh download
```

Pull les images Docker de base (`python:3.12-slim`, `alpine:latest`) et installe les deps npm/bun du frontend. Utile pour préparer le terrain avant d'aller dormir, ou sur une machine fraîche.

### Rebuild propre sans re-télécharger

```bash
./scripts/manage.sh rebuild
```

Comme `full`, mais skip l'étape `download`. Utilise les caches déjà présents. Bon compromis entre rapidité et propreté quand tu as bricolé le Dockerfile et veux repartir d'un binaire frais sans rejouer les téléchargements.

---

## Commandes de gestion

Tout passe par un seul script : `scripts/manage.sh`.

| Commande | Ce qu'elle fait |
|---|---|
| `download` | Pull les images Docker + npm/bun install. Ne touche pas au conteneur. |
| `up` *(ou `fast`)* | Reconstruit ce qui a changé et redémarre. À utiliser au quotidien. |
| `full` | **download** + reconstruction complète sans cache. À utiliser après gros changements ou première install. |
| `rebuild` | Reconstruction complète sans cache, **sans télécharger**. Utilise les caches existants. |
| `restart` | Redémarre simplement le conteneur, sans rebuild. |
| `maintenance` | Redémarre, nettoie le cache Docker, supprime les fichiers temporaires. |
| `stop` | Arrête et supprime le conteneur. |
| `logs` | Affiche les logs en direct. |
| `status` | Affiche l'état du conteneur et le résultat du health check. |
| `install-cron` | Installe la maintenance automatique tous les 4 jours. |
| `uninstall-cron` | Retire la maintenance automatique. |

Toutes les actions sont enregistrées dans `scripts/manage.log`.

---

## Maintenance automatique

```bash
./scripts/manage.sh install-cron
```

Configure une tâche planifiée qui se déclenche **tous les 4 jours à 4 h du matin**. Elle :

1. Redémarre le conteneur (évite que l'app reste bloquée sur des requêtes anormales).
2. Vérifie le health check.
3. Nettoie le cache Docker et les fichiers temporaires.

Pour désactiver : `./scripts/manage.sh uninstall-cron`.

---

## Options de configuration

À définir dans `docker-compose.yml` ou en variables d'environnement :

| Variable | Défaut | Description |
|---|---:|---|
| `RETENTION_SECONDS` | `10800` | Durée de conservation des fichiers convertis, en secondes (3 h par défaut). |
| `CLEANUP_INTERVAL_SECONDS` | `300` | Fréquence du nettoyage automatique. |
| `MAX_ENQUEUED_JOBS` | `50` | Nombre maximum de jobs simultanés par session. |
| `LOG_LEVEL` | `INFO` | Niveau de log : DEBUG, INFO, WARNING, ERROR. |

---

## Architecture rapide

**Backend** (Flask, Python 3.12, gunicorn, SQLite, ThreadPoolExecutor par type de média)
- FFmpeg compilé from source (libx264 + libmp3lame + libopus, voir Dockerfile)
- Pillow + Pillow-HEIF + cairosvg + rawpy pour les images (RAW + SVG inclus)
- pypdf pour la compression PDF
- LibreOffice headless pour les conversions Office
- trimesh pour les modèles 3D
- Headers Cross-Origin-Opener-Policy + Cross-Origin-Embedder-Policy=credentialless servis sur toutes les réponses, pour permettre à `SharedArrayBuffer` (et donc ffmpeg.wasm) de fonctionner côté navigateur

**Frontend** (React 19, Vite, Tailwind, Radix UI)
- `clientProcessor.ts` : pipeline image client-side (Canvas + libs gifenc, utif, jspdf pour les formats exotiques)
- `clientVideoProcessor.ts` : ffmpeg.wasm en mode multi-thread quand `crossOriginIsolated`, sinon single-thread
- `cubeLut.ts` : parser de fichiers Adobe `.cube` + interpolation trilinéaire
- `lutCanvas2D.ts` : pipeline d'étalonnage live (LUT + 12 effets) en Canvas 2D
- `ColorLab.tsx` : workspace multi-fichiers avec preview live et navigation carousel

---

## Licence

Projet personnel. Code fourni en l'état, sans garantie. Usage non commercial.
