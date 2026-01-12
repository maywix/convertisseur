document.addEventListener('DOMContentLoaded', () => {
    // --- Elements ---
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileListEl = document.getElementById('file-list');
    const startBtn = document.getElementById('start-btn');
    const clearBtn = document.getElementById('clear-btn');
    const fileCountEl = document.getElementById('file-count');
    const template = document.getElementById('file-item-template');
    
    // Config Elements
    const tabs = document.querySelectorAll('.tab');
    const convertSettings = document.getElementById('convert-settings');
    const compressSettings = document.getElementById('compress-settings');
    const formatSelect = document.getElementById('global-format-select');
    const compModeRadios = document.querySelectorAll('input[name="comp-mode"]');
    
    // Dynamic Inputs
    const inputCrf = document.getElementById('input-crf');
    const inputSize = document.getElementById('input-size');
    const inputPercent = document.getElementById('input-percent');
    const inputRes = document.getElementById('input-res');
    
    // State
    let queue = []; // Array of { id, file, status, element }
    let currentAction = 'convert'; // 'convert' or 'compress'
    let isProcessing = false;

    // --- supported formats ---
    const commonFormats = ['mp4', 'avi', 'mkv', 'mp3', 'wav', 'pdf', 'jpg', 'png'];
    // Populate simple global format list (generic)
    commonFormats.forEach(fmt => {
        const opt = document.createElement('option');
        opt.value = fmt;
        opt.textContent = fmt.toUpperCase();
        formatSelect.appendChild(opt);
    });


    // --- 1. UI Interaction Logic ---
    
    // Tabs
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentAction = tab.dataset.action;
            
            if(currentAction === 'convert') {
                convertSettings.classList.remove('hidden');
                compressSettings.classList.add('hidden');
            } else {
                convertSettings.classList.add('hidden');
                compressSettings.classList.remove('hidden');
            }
        });
    });

    // Compression Mode Switching
    compModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            // Hide all inputs first
            inputCrf.classList.add('hidden');
            inputSize.classList.add('hidden');
            inputPercent.classList.add('hidden');
            inputRes.classList.add('hidden');

            // Show selected
            switch(e.target.value) {
                case 'crf': inputCrf.classList.remove('hidden'); break;
                case 'size': inputSize.classList.remove('hidden'); break;
                case 'percent': inputPercent.classList.remove('hidden'); break;
                case 'res': inputRes.classList.remove('hidden'); break;
            }
        });
    });

    // Range Slider Value Display
    const percentSlider = document.getElementById('percent-slider');
    const percentVal = document.getElementById('percent-val');
    percentSlider.addEventListener('input', (e) => percentVal.textContent = e.target.value);


    // --- 2. File Queue Management ---

    // Drag & Drop
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
        fileInput.value = ''; // Reset to allow re-uploading same file
    });

    function addFilesToQueue(files) {
        // Remove empty state if present
        if(queue.length === 0) fileListEl.innerHTML = '';

        Array.from(files).forEach(file => {
            const id = Math.random().toString(36).substring(7);
            
            // Clone Template
            const clone = template.content.cloneNode(true);
            const el = clone.querySelector('.file-item');
            
            // Populate Data
            el.querySelector('.file-name').textContent = file.name;
            el.querySelector('.file-meta').textContent = formatSize(file.size) + ' • En attente';
            
            // Event Listeners
            el.querySelector('.remove-btn').addEventListener('click', () => removeFile(id));
            
            fileListEl.appendChild(el);
            
            queue.push({
                id: id,
                file: file,
                status: 'pending', // pending, uploading, processing, done, error
                element: el
            });
        });

        updateUI();
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

    clearBtn.addEventListener('click', () => {
        queue = [];
        fileListEl.innerHTML = '<div class="empty-state">Aucun fichier en attente</div>';
        updateUI();
    });

    function updateUI() {
        fileCountEl.textContent = `(${queue.length})`;
        startBtn.disabled = queue.length === 0 || isProcessing;
    }

    function formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }


    // --- 3. Processing Logic (Sequential) ---

    startBtn.addEventListener('click', () => {
        if (isProcessing || queue.length === 0) return;
        isProcessing = true;
        startBtn.disabled = true;
        startBtn.textContent = "Traitement en cours...";
        
        processNextInQueue(0);
    });

    async function processNextInQueue(index) {
        if (index >= queue.length) {
            isProcessing = false;
            startBtn.disabled = false;
            startBtn.textContent = "Lancer le traitement";
            alert("Traitement de la file terminé !");
            return;
        }

        const item = queue[index];
        if (item.status === 'done') {
            processNextInQueue(index + 1);
            return;
        }

        // Update UI to "Processing"
        const metaEl = item.element.querySelector('.file-meta');
        const barEl = item.element.querySelector('.progress-bar-fill');
        metaEl.textContent = "Traitement en cours...";
        barEl.style.width = "50%"; // Fake progress for start

        // Prepare Data
        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('action', currentAction);
        
        // Settings
        if (currentAction === 'convert') {
            formData.append('format', formatSelect.value);
        } else {
            // Compress Settings
            const mode = document.querySelector('input[name="comp-mode"]:checked').value;
            formData.append('comp_mode', mode);
            
            // Get Value based on mode
            let val = '';
            if (mode === 'crf') {
                // Map range 1-3 to low/medium/high
                const map = {1: 'low', 2: 'medium', 3: 'high'};
                val = map[document.getElementById('crf-slider').value];
            } else if (mode === 'size') {
                val = document.getElementById('target-size').value;
            } else if (mode === 'percent') {
                val = document.getElementById('percent-slider').value;
            } else if (mode === 'res') {
                val = document.getElementById('res-select').value;
            }
            formData.append('comp_value', val);
        }

        try {
            const response = await fetch('/process', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (response.ok) {
                // Success
                item.status = 'done';
                barEl.style.width = "100%";
                barEl.style.backgroundColor = "var(--success)";
                metaEl.textContent = "Terminé";
                metaEl.style.color = "var(--success)";
                
                // Show Download
                const dlBtn = item.element.querySelector('.download-btn');
                dlBtn.href = data.download_url;
                dlBtn.classList.remove('hidden');
                dlBtn.setAttribute('download', data.filename);
                
                // Remove Delete Btn to prevent error
                item.element.querySelector('.remove-btn').remove();

            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            item.status = 'error';
            barEl.style.backgroundColor = "var(--danger)";
            metaEl.textContent = "Erreur: " + error.message;
            metaEl.style.color = "var(--danger)";
        }

        // Next
        processNextInQueue(index + 1);
    }
});
