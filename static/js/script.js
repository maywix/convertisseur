document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileListEl = document.getElementById('file-list');
    const startBtn = document.getElementById('start-btn');
    const clearBtn = document.getElementById('clear-btn');
    const downloadAllBtn = document.getElementById('download-all-btn');
    const fileCountEl = document.getElementById('file-count');
    const template = document.getElementById('file-item-template');

    const tabs = document.querySelectorAll('.tab');
    const convertSettings = document.getElementById('convert-settings');
    const compressSettings = document.getElementById('compress-settings');
    const formatSelect = document.getElementById('global-format-select');
    const compModeRadios = document.querySelectorAll('input[name="comp-mode"]');
    const categoryButtons = document.querySelectorAll('.cat-btn');

    const inputCrf = document.getElementById('input-crf');
    const inputSize = document.getElementById('input-size');
    const inputPercent = document.getElementById('input-percent');
    const inputRes = document.getElementById('input-res');

    // Image resolution controls
    const imageResSelect = document.getElementById('image-res-select');
    const imageResCustomWrapper = document.getElementById('image-res-custom-wrapper');
    const imageResCustomInput = document.getElementById('image-res-custom');

    const icoSettings = document.getElementById('ico-settings');
    const icoSizeSelect = document.getElementById('ico-size-select');
    const icoCustomWrapper = document.getElementById('ico-custom-wrapper');
    const icoCustomInput = document.getElementById('ico-custom-size');

    // Compress image resolution controls
    const compressImageResSelect = document.getElementById('compress-image-res-select');
    const compressImageResCustomWrapper = document.getElementById('compress-image-res-custom-wrapper');
    const compressImageResCustomInput = document.getElementById('compress-image-res-custom');

    // Advanced Mode Elements
    const advancedToggle = document.getElementById('advanced-toggle');
    const advancedSettings = document.getElementById('advanced-settings');
    const gifSettings = document.getElementById('gif-settings');
    const imageQualitySettings = document.getElementById('image-quality-settings');

    let queue = [];
    let currentAction = 'convert';
    let selectedCategory = null;
    let isProcessing = false;

    // Format definitions
    const videoFormats = ["mp4", "mov", "avi", "mkv", "webm", "wmv", "flv", "m4v", "mpeg", "gif", "ts"];
    const audioFormats = ["mp3", "wav", "m4a", "flac", "aac", "ogg", "wma", "opus"];
    const imageFormats = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "ico"];

    const imageExtensions = [
        "png", "jpg", "jpeg", "gif", "tiff", "tif", "bmp", "psd",
        "heic", "heif", "webp", "ico", "jp2", "j2k", "jpf", "jpm",
        "raw", "cr2", "nef", "arw", "dng", "orf", "rw2", "pef",
        "tga", "sgi", "qtif", "pict", "icns"
    ];

    const videoExtensions = [
        "mp4", "mov", "avi", "mkv", "webm", "wmv", "flv", "m4v",
        "mpeg", "mpg", "3gp", "3g2", "ts", "mts", "m2ts", "vob",
        "ogv", "divx", "xvid", "asf", "rm", "rmvb", "f4v"
    ];

    const audioExtensions = [
        "mp3", "wav", "m4a", "flac", "aac", "ogg", "wma", "aiff",
        "aif", "opus", "ac3", "dts", "amr", "ape", "mka", "mpa",
        "au", "ra", "mid", "midi"
    ];

    function getFileType(filename) {
        if (!filename) return 'unknown';
        const ext = filename.split('.').pop().toLowerCase();
        if (imageExtensions.includes(ext)) return 'image';
        if (videoExtensions.includes(ext)) return 'video';
        if (audioExtensions.includes(ext)) return 'audio';
        return 'unknown';
    }

    // Category button handlers
    categoryButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedCategory = btn.dataset.category;
            updateFormatOptions();
        });
    });

    function updateFormatOptions() {
        formatSelect.innerHTML = '';
        
        if (!selectedCategory) {
            formatSelect.innerHTML = '<option value="" disabled selected>Sélectionnez un type d\'abord...</option>';
            return;
        }

        let formats = [];
        let label = '';
        
        if (selectedCategory === 'video') {
            formats = videoFormats;
            label = 'Formats Vidéo';
        } else if (selectedCategory === 'audio') {
            formats = audioFormats;
            label = 'Formats Audio';
        } else if (selectedCategory === 'image') {
            formats = imageFormats;
            label = 'Formats Image';
        }

        // Auto-select the first format option for better UX
        formats.forEach((fmt, index) => {
            const opt = document.createElement('option');
            opt.value = fmt;
            opt.textContent = fmt.toUpperCase();
            if (index === 0) opt.selected = true;
            formatSelect.appendChild(opt);
        });

        // Trigger change event asynchronously to sync all dependent UI after DOM updates
        setTimeout(() => {
            const changeEvent = new Event('change', { bubbles: true });
            formatSelect.dispatchEvent(changeEvent);
        }, 0);
    }

    function updateGifSettingsVisibility() {
        const format = formatSelect.value;
        // GIF settings for video->GIF conversion
        if (currentAction === 'convert' && format === 'gif' && selectedCategory === 'video') {
            gifSettings.classList.remove('hidden');
        } else {
            gifSettings.classList.add('hidden');
        }
        // Image quality settings for image category
        if (currentAction === 'convert' && selectedCategory === 'image') {
            imageQualitySettings.classList.remove('hidden');
        } else {
            imageQualitySettings.classList.add('hidden');
        }

        updateImageConditionalUI();
    }

    function toggleCustomInput(selectEl, wrapperEl) {
        if (!selectEl || !wrapperEl) return;
        if (selectEl.value === 'custom') {
            wrapperEl.classList.remove('hidden');
        } else {
            wrapperEl.classList.add('hidden');
        }
    }

    function getMaxDimension(selectEl, customInput) {
        if (!selectEl) return null;
        const val = selectEl.value;
        if (!val || val === 'original') return null;
        if (val === 'custom') {
            if (!customInput) return null;
            const customVal = parseInt(customInput.value, 10);
            return Number.isFinite(customVal) && customVal > 0 ? customVal : null;
        }
        const parsed = parseInt(val, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function getIcoSizeValue() {
        if (!icoSizeSelect) return null;
        const val = icoSizeSelect.value;
        if (val === 'custom') {
            const customVal = parseInt(icoCustomInput?.value || '', 10);
            return Number.isFinite(customVal) && customVal > 0 ? customVal : null;
        }
        if (val === 'original') return 'original';
        const parsed = parseInt(val, 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function updateImageConditionalUI() {
        toggleCustomInput(imageResSelect, imageResCustomWrapper);
        toggleCustomInput(compressImageResSelect, compressImageResCustomWrapper);
        toggleCustomInput(icoSizeSelect, icoCustomWrapper);

        const isImageConvert = currentAction === 'convert' && selectedCategory === 'image';
        if (icoSettings) {
            if (isImageConvert && formatSelect.value === 'ico') {
                icoSettings.classList.remove('hidden');
            } else {
                icoSettings.classList.add('hidden');
            }
        }
    }

    formatSelect.addEventListener('change', () => {
        updateGifSettingsVisibility();
        updateUI();
    });

    [imageResSelect, icoSizeSelect, compressImageResSelect].forEach(el => {
        el?.addEventListener('change', updateImageConditionalUI);
    });

    [imageResCustomInput, icoCustomInput, compressImageResCustomInput].forEach(el => {
        el?.addEventListener('input', () => {});
    });

    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentAction = tab.dataset.action;

            if (currentAction === 'convert') {
                convertSettings.classList.remove('hidden');
                compressSettings.classList.add('hidden');
            } else {
                convertSettings.classList.add('hidden');
                compressSettings.classList.remove('hidden');
            }
            updateUI();
            updateGifSettingsVisibility();
        });
    });

    // Initialize UI state
    updateImageConditionalUI();

    // Compression mode radio handlers
    compModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            inputCrf.classList.add('hidden');
            inputSize.classList.add('hidden');
            inputPercent.classList.add('hidden');
            inputRes.classList.add('hidden');

            switch (e.target.value) {
                case 'crf': inputCrf.classList.remove('hidden'); break;
                case 'size': inputSize.classList.remove('hidden'); break;
                case 'percent': inputPercent.classList.remove('hidden'); break;
                case 'res': inputRes.classList.remove('hidden'); break;
            }
        });
    });

    const percentSlider = document.getElementById('percent-slider');
    const percentVal = document.getElementById('percent-val');
    percentSlider.addEventListener('input', (e) => percentVal.textContent = e.target.value);

    // Advanced toggle (only for compress mode)
    advancedToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            advancedSettings.classList.remove('hidden');
        } else {
            advancedSettings.classList.add('hidden');
        }
    });

    // Drag and drop
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--border)'; });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--border)';
        if (e.dataTransfer.files.length) addFilesToQueue(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) addFilesToQueue(e.target.files);
        fileInput.value = '';
    });

    async function addFilesToQueue(files) {
        if (queue.length === 0) fileListEl.innerHTML = '';

        for (const file of Array.from(files)) {
            const id = Math.random().toString(36).substring(7);

            const clone = template.content.cloneNode(true);
            const el = clone.querySelector('.file-item');

            el.querySelector('.file-name').textContent = file.name;
            el.querySelector('.file-meta').textContent = formatSize(file.size) + ' • En attente';

            el.querySelector('.remove-btn').addEventListener('click', () => removeFile(id));

            // Generate thumbnail
            const thumbImg = el.querySelector('.thumb-img');
            const thumbPlaceholder = el.querySelector('.thumb-placeholder');
            
            const fileType = getFileType(file.name);
            
            if (fileType === 'image') {
                // For images, generate thumbnail from file
                try {
                    const thumbUrl = await generateImageThumbnail(file);
                    thumbImg.src = thumbUrl;
                    thumbImg.style.display = 'block';
                    thumbPlaceholder.style.display = 'none';
                } catch (e) {
                    thumbPlaceholder.textContent = '🖼️';
                }
            } else if (fileType === 'video') {
                thumbPlaceholder.textContent = '🎬';
                thumbPlaceholder.style.display = 'flex';
                thumbImg.style.display = 'none';
            } else if (fileType === 'audio') {
                thumbPlaceholder.textContent = '🎵';
                thumbPlaceholder.style.display = 'flex';
                thumbImg.style.display = 'none';
            } else {
                thumbPlaceholder.textContent = '📄';
                thumbPlaceholder.style.display = 'flex';
                thumbImg.style.display = 'none';
            }

            fileListEl.appendChild(el);

            queue.push({
                id: id,
                file: file,
                status: 'pending',
                jobId: null,
                element: el,
                existing: false
            });
        }

        updateUI();
    }

    function generateImageThumbnail(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const size = 90;
                    let width = img.width;
                    let height = img.height;
                    
                    // Calculate aspect ratio
                    if (width > height) {
                        height = (height / width) * size;
                        width = size;
                    } else {
                        width = (width / height) * size;
                        height = size;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function removeFile(id) {
        const index = queue.findIndex(item => item.id === id);
        if (index > -1) {
            queue[index].element.remove();
            queue.splice(index, 1);
            if (queue.length === 0) {
                fileListEl.innerHTML = '<div class="empty-state">Aucun fichier en attente</div>';
            }
            updateUI();
        }
    }

    clearBtn.addEventListener('click', async () => {
        if (!confirm('Supprimer tous les fichiers (originaux et convertis) du serveur ?')) {
            return;
        }
        
        // Call server to delete all files
        try {
            const resp = await fetch('/clear-all', { method: 'DELETE' });
            const data = await resp.json();
            console.log(`Deleted ${data.deleted} jobs from server`);
        } catch (e) {
            console.error('Failed to clear server files:', e);
        }
        
        // Clear local queue
        queue = [];
        fileListEl.innerHTML = '<div class="empty-state">Aucun fichier en attente</div>';
        updateUI();
    });

    // Download All button
    downloadAllBtn.addEventListener('click', () => {
        // Check if there are any completed files
        const hasCompleted = queue.some(x => x.status === 'done');
        if (!hasCompleted) {
            alert('Aucun fichier terminé à télécharger');
            return;
        }
        
        // Trigger download
        window.location.href = '/download-all';
    });

    function updateUI() {
        fileCountEl.textContent = `(${queue.length})`;
        const hasNewFiles = queue.some(x => x.file && x.status === 'pending');
        const hasCompleted = queue.some(x => x.status === 'done');
        
        let canStart = false;
        if (currentAction === 'convert') {
            // For convert: need category selected AND format selected
            canStart = hasNewFiles && selectedCategory && formatSelect.value;
        } else {
            // For compress: just need files
            canStart = hasNewFiles;
        }
        
        startBtn.disabled = !canStart || isProcessing;
        downloadAllBtn.disabled = !hasCompleted;
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    startBtn.addEventListener('click', () => {
        if (isProcessing || queue.length === 0) return;

        // Snapshot current action/format so user changes mid-flight don't break uploads
        const actionSnapshot = currentAction;
        const formatSnapshot = formatSelect.value;

        if (actionSnapshot === 'convert' && !formatSnapshot) {
            return; // Guard: UI should already prevent this
        }

        queue.forEach(item => {
            if (item.status === 'pending') {
                item.action = actionSnapshot;
                item.targetFormat = actionSnapshot === 'convert' ? formatSnapshot : null;
            }
        });

        isProcessing = true;
        
        // Start global polling if not already running
        startGlobalPolling();
        
        startBtn.disabled = true;
        startBtn.textContent = "Conversion en cours...";

        processQueue().finally(() => {
            // Processing/Uploads submitted
             isProcessing = false;
             // We keep button disabled if logic requires, but usually we allow more
             // In this flow, we wait for polling to finish to reset UI fully?
             // Or we let user add more files.
        });
    });

    const MAX_CONCURRENT_UPLOADS = 8;

    async function processQueue() {
        // Filter pending items
        const pendingItems = queue.filter(item => item.status === 'pending');
        if (pendingItems.length === 0) return;

        let index = 0;
        const activeUploads = [];

        while (index < pendingItems.length || activeUploads.length > 0) {
            while (activeUploads.length < MAX_CONCURRENT_UPLOADS && index < pendingItems.length) {
                const p = uploadItem(pendingItems[index++]).then(() => {
                    activeUploads.splice(activeUploads.indexOf(p), 1);
                });
                activeUploads.push(p);
            }
            if (activeUploads.length === 0) break;
            await Promise.race(activeUploads);
        }
    }

    async function uploadItem(item) {
        if (item.status !== 'pending') return;

        const metaEl = item.element.querySelector('.file-meta');
        const barEl = item.element.querySelector('.progress-bar-fill');

        const action = item.action || currentAction;
        const targetFormat = item.targetFormat || formatSelect.value;
        
        // Validate format before upload for convert action
        if (action === 'convert' && !targetFormat) {
            console.warn('Upload blocked: missing format', { action, targetFormat, currentAction, formatSelectValue: formatSelect.value, file: item.file?.name });
            item.status = 'error';
            barEl.style.backgroundColor = "var(--danger)";
            metaEl.textContent = "Erreur: format de destination manquant (aucun format)";
            return;
        }
        
        metaEl.textContent = "envoi...";
        barEl.style.width = "25%";

        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('action', action);

        if (action === 'convert') {
            formData.append('format', targetFormat);

            // GIF params
            if (gifSettings && !gifSettings.classList.contains('hidden')) {
                const gSpeedEl = document.getElementById('gif-speed');
                const gFpsEl = document.getElementById('gif-fps');
                const gResEl = document.getElementById('gif-resolution');

                if (gSpeedEl && gSpeedEl.value) formData.append('gif_speed', gSpeedEl.value);
                if (gFpsEl && gFpsEl.value) formData.append('gif_fps', gFpsEl.value);
                if (gResEl && gResEl.value) formData.append('gif_resolution', gResEl.value);
            }
            
            // Image quality params
            if (imageQualitySettings && !imageQualitySettings.classList.contains('hidden')) {
                const imageQualitySelect = document.getElementById('image-quality');
                if (imageQualitySelect) {
                    const qVal = imageQualitySelect.value;
                    if (qVal === 'lossless') {
                        formData.append('lossless', 'true');
                    } else {
                        formData.append('image_quality', qVal);
                    }
                }
            }

            // Image resize params (convert mode)
            if (selectedCategory === 'image') {
                const maxDim = getMaxDimension(imageResSelect, imageResCustomInput);
                if (maxDim) {
                    formData.append('image_max_size', String(maxDim));
                }

                if (targetFormat === 'ico') {
                    const icoVal = getIcoSizeValue();
                    if (icoVal) {
                        formData.append('ico_size', String(icoVal));
                    }
                }
            }
        } else {
            // Compress mode
            let mode = 'crf';
            const checked = document.querySelector('input[name="comp-mode"]:checked');
            if (checked) mode = checked.value;
            formData.append('comp_mode', mode);

            let val = '';
            if (mode === 'crf') {
                const map = { 1: 'low', 2: 'medium', 3: 'high' };
                val = map[document.getElementById('crf-slider').value];
            } else if (mode === 'size') {
                val = document.getElementById('target-size').value;
            } else if (mode === 'percent') {
                val = document.getElementById('percent-slider').value;
            } else if (mode === 'res') {
                val = document.getElementById('res-select').value;
            }
            formData.append('comp_value', val);

            // Advanced params for compress mode only
            if (advancedToggle.checked) {
                const fps = document.getElementById('adv-fps').value;
                const preset = document.getElementById('adv-preset').value;
                const aBitrate = document.getElementById('adv-audio-bitrate').value;
                const aChannels = document.getElementById('adv-audio-channels').value;
                const aRate = document.getElementById('adv-audio-rate').value;

                if (fps) formData.append('fps', fps);
                if (preset) formData.append('video_preset', preset);
                if (aBitrate) formData.append('audio_bitrate', aBitrate);
                if (aChannels) formData.append('audio_channels', aChannels);
                if (aRate) formData.append('audio_sample_rate', aRate);
            }

            // Image resize params (compress mode)
            const maxDimCompress = getMaxDimension(compressImageResSelect, compressImageResCustomInput);
            if (maxDimCompress) {
                formData.append('image_max_size', String(maxDimCompress));
            }
        }

        try {
            console.debug('Uploading item', { action, targetFormat, name: item.file?.name });
            const response = await fetch('/jobs', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (response.ok) {
                item.jobId = data.job_id;
                item.status = 'queued';
                barEl.style.width = "35%";
                metaEl.textContent = "en file d'attente...";
                // No await pollJob here!
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            item.status = 'error';
            barEl.style.backgroundColor = "var(--danger)";
            metaEl.textContent = "Erreur: " + error.message;
            metaEl.style.color = "var(--danger)";
        }
    }

    let pollingInterval = null;
    function startGlobalPolling() {
        if (pollingInterval) return;
        pollingInterval = setInterval(updateAllJobs, 1500);
    }

    async function updateAllJobs() {
        // Find items that need updates
        const activeItems = queue.filter(item => 
            (item.status === 'queued' || item.status === 'processing') && item.jobId
        );
        
        if (activeItems.length === 0 && !isProcessing) {
            // Stop polling if nothing is active and we are not currently uploading
            // Only stop if ALL done
            const anyPending = queue.some(x => x.status === 'pending');
            if (!anyPending) {
                clearInterval(pollingInterval);
                pollingInterval = null;
                startBtn.disabled = false;
                startBtn.textContent = "Lancer le traitement";
                updateUI();
                return;
            }
        }
        
        if (activeItems.length === 0) return;

        try {
            const resp = await fetch('/jobs?limit=200');
            if(!resp.ok) return;
            const data = await resp.json();
            const jobsMap = new Map();
            (data.jobs || []).forEach(j => jobsMap.set(j.id, j));

            activeItems.forEach(item => {
                const job = jobsMap.get(item.jobId);
                if (!job) return;

                const metaEl = item.element.querySelector('.file-meta');
                const barEl = item.element.querySelector('.progress-bar-fill');

                if (job.status === 'processing') {
                    if (item.status !== 'processing') {
                         item.status = 'processing';
                         metaEl.textContent = "traitement en cours...";
                         barEl.style.width = "70%";
                    }
                } else if (job.status === 'done') {
                    item.status = 'done';
                    barEl.style.width = "100%";
                    barEl.style.backgroundColor = "var(--success)";
                    metaEl.textContent = "terminé";
                    metaEl.style.color = "var(--success)";

                    const dlBtn = item.element.querySelector('.download-btn');
                    dlBtn.href = job.download_url;
                    dlBtn.classList.remove('hidden');
                    if (job.output_filename) {
                        dlBtn.setAttribute('download', job.output_filename);
                    }
                    if (item.element.querySelector('.remove-btn')) {
                        item.element.querySelector('.remove-btn').remove();
                    }
                    updateUI();
                } else if (job.status === 'error') {
                    item.status = 'error';
                    barEl.style.backgroundColor = "var(--danger)";
                    metaEl.textContent = "erreur: " + (job.error || 'echec');
                    metaEl.style.color = "var(--danger)";
                }
            });
        } catch (e) {
            console.error("Polling error", e);
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function loadExistingJobs() {
        try {
            const resp = await fetch('/jobs?limit=100');
            const data = await resp.json();
            if (!resp.ok) return;
            const jobs = (data.jobs || []);
            if (!jobs.length) return;

            if (queue.length === 0) fileListEl.innerHTML = '';

            jobs.reverse().forEach(job => {
                const id = `job_${job.id}`;
                const clone = template.content.cloneNode(true);
                const el = clone.querySelector('.file-item');

                el.querySelector('.file-name').textContent = job.original_filename || job.id;
                el.querySelector('.file-meta').textContent = statusLabel(job.status, job.error);

                const barEl = el.querySelector('.progress-bar-fill');
                const metaEl = el.querySelector('.file-meta');
                const thumbPlaceholder = el.querySelector('.thumb-placeholder');
                const thumbImg = el.querySelector('.thumb-img');
                
                // Set placeholder icon based on type
                const fileType = getFileType(job.original_filename || '');
                if (fileType === 'video') thumbPlaceholder.textContent = '🎬';
                else if (fileType === 'audio') thumbPlaceholder.textContent = '🎵';
                else if (fileType === 'image') thumbPlaceholder.textContent = '🖼️';
                else thumbPlaceholder.textContent = '📄';
                
                thumbPlaceholder.style.display = 'flex';
                thumbImg.style.display = 'none';

                if (job.status === 'done') {
                    barEl.style.width = "100%";
                    barEl.style.backgroundColor = "var(--success)";
                    metaEl.style.color = "var(--success)";
                    const dlBtn = el.querySelector('.download-btn');
                    dlBtn.href = job.download_url;
                    dlBtn.classList.remove('hidden');
                    if (job.output_filename) {
                        dlBtn.setAttribute('download', job.output_filename);
                    }
                    el.querySelector('.remove-btn').remove();
                } else if (job.status === 'processing') {
                    barEl.style.width = "70%";
                } else if (job.status === 'queued') {
                    barEl.style.width = "40%";
                } else if (job.status === 'error') {
                    barEl.style.width = "100%";
                    barEl.style.backgroundColor = "var(--danger)";
                    metaEl.style.color = "var(--danger)";
                }

                el.querySelector('.remove-btn')?.addEventListener('click', () => removeFile(id));
                fileListEl.appendChild(el);

                queue.push({
                    id: id,
                    file: null,
                    status: job.status,
                    jobId: job.id,
                    element: el,
                    existing: true
                });
            });

            updateUI();
        } catch (e) {
            console.error('Failed to load existing jobs', e);
        }
    }

    function statusLabel(status, error) {
        if (status === 'queued') return 'en attente';
        if (status === 'processing') return 'traitement';
        if (status === 'done') return 'terminé';
        if (status === 'error') return 'erreur: ' + (error || 'erreur');
        return status || 'état inconnu';
    }

    loadExistingJobs().catch(() => { });
});
