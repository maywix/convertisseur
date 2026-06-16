# Convertisseur Studio

Convertisseur de médias auto-hébergé. Tu déposes des fichiers, tu choisis un format ou un mode de compression, et tu récupères le résultat. Vidéo, audio, image, documents Office et modèles 3D, le tout dans une seule app accessible depuis un navigateur.

> **Statut : en reconstruction.** L'interface est en refonte. Certaines fonctionnalités peuvent être instables et l'API évolue encore.

---

## Sommaire

- [Ce que ça fait](#ce-que-ça-fait)
- [Formats compatibles](#formats-compatibles)
- [Démarrage](#démarrage)
- [Utilisation](#utilisation)
- [Commandes de gestion](#commandes-de-gestion)
- [Maintenance automatique](#maintenance-automatique)
- [Options de configuration](#options-de-configuration)
- [Roadmap](#roadmap)

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

**Retirer une couleur (color remover)**
- Sélection d'une couleur à la pipette ou en hexadécimal
- Tolérance ajustable
- Fonctionne sur images **et** vidéos
- Sortie en PNG / WebP (image) ou WebM / MOV (vidéo) pour conserver la transparence

**Audio**
- Changement de codec et de bitrate
- Normalisation EBU R128
- Gain en décibels

**GIF animés**
- Palette adaptative
- Dithering Sierra / Floyd-Steinberg / Bayer
- Contrôle vitesse, FPS, boucle

**Lots et séquences**
- Upload illimité
- Plusieurs jobs en parallèle
- Tu peux fermer le navigateur et revenir plus tard, les jobs continuent
- Suite d'images vers vidéo
- Vidéo vers suite d'images PNG (export ZIP)

**Téléchargement** individuel ou ZIP global pour récupérer tout en une fois.

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

**Sortie** : pdf

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

Le premier lancement prend **30 à 45 minutes** car FFmpeg est compilé depuis les sources pour avoir un binaire optimisé.

L'application est ensuite disponible sur **http://localhost:6060**.

### Lancements suivants

```bash
./scripts/manage.sh up
```

Construit uniquement ce qui a changé et redémarre le conteneur. Beaucoup plus rapide qu'un `full`.

---

## Utilisation

1. Ouvre **http://localhost:6060** dans un navigateur.
2. Glisse-dépose un ou plusieurs fichiers dans la zone d'upload.
3. Choisis l'action dans le panneau de droite :
   - **Convertir** : sélectionne le type de média et le format de sortie.
   - **Compresser** : choisis un mode (qualité, taille, pourcentage, résolution).
   - **Convertir + compresser** : combine les deux.
4. Active les options avancées dont tu as besoin (édition vidéo, retirer une couleur, paramètres audio, etc.).
5. Clique sur **Démarrer**.
6. Récupère les fichiers depuis la file d'attente, soit un par un, soit en ZIP global.

Le mode **Avancé** (en haut à droite) débloque tous les réglages détaillés. Le mode **Simple** garde juste l'essentiel.

---

## Commandes de gestion

Tout passe par un seul script : `scripts/manage.sh`.

| Commande | Ce qu'elle fait |
|---|---|
| `up` *(ou `fast`)* | Reconstruit ce qui a changé et redémarre. À utiliser au quotidien. |
| `full` | Reconstruction complète sans cache. À utiliser après gros changements. |
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

## Roadmap

- [x] Color remover image et vidéo
- [x] Maintenance automatique
- [x] Interface React
- [ ] Refonte complète de la file d'attente côté interface
- [ ] Presets vidéo avec transparence automatique (WebM / MOV)
- [ ] Authentification optionnelle par token
- [ ] Mode multi-utilisateur avec quotas

---

## Licence

Projet personnel. Code fourni en l'état, sans garantie. Usage non commercial.
