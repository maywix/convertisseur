document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileListEl = document.getElementById('file-list');
    const startBtn = document.getElementById('start-btn');
    const clearBtn = document.getElementById('clear-btn');
    const fileCountEl = document.getElementById('file-count');
    const template = document.getElementById('file-item-template');
    
    const tabs = document.querySelectorAll('.tab');
    const convertSettings = document.getElementById('convert-settings');
    const compressSettings = document.getElementById('compress-settings');
    const formatSelect = document.getElementById('global-format-select');
    const compModeRadios = document.querySelectorAll('input[name="comp-mode"]');
    
    const inputCrf = document.getElementById('input-crf');
    const inputSize = document.getElementById('input-size');
    const inputPercent = document.getElementById('input-percent');
    const inputRes = document.getElementById('input-res');
    
    let queue = [];
    let currentAction = 'convert';
    let isProcessing = false;

    const commonFormats = ['mp4', 'avi', 'mkv', 'mp3', 'wav', 'pdf', 'jpg', 'png'];
    commonFormats.forEach(fmt => {
        const opt = document.createElement('option');
        opt.value = fmt;
        opt.textContent = fmt.toUpperCase();
        formatSelect.appendChild(opt);
    });

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
            updateUI();
        });
    });

    compModeRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            inputCrf.classList.add('hidden');
            inputSize.classList.add('hidden');
            inputPercent.classList.add('hidden');
            inputRes.classList.add('hidden');

            switch(e.target.value) {
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
        if(queue.length === 0) fileListEl.innerHTML = '';

        Array.from(files).forEach(file => {
            const id = Math.random().toString(36).substring(7);
            
            const clone = template.content.cloneNode(true);
            const el = clone.querySelector('.file-item');
            
            el.querySelector('.file-name').textContent = file.name;
            el.querySelector('.file-meta').textContent = formatSize(file.size) + ' • En attente';
            
            el.querySelector('.remove-btn').addEventListener('click', () => removeFile(id));
            
            fileListEl.appendChild(el);
            
            queue.push({
                id: id,
                file: file,
                status: 'pending',
                jobId: null,
                element: el,
                existing: false
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
        const hasNewFiles = queue.some(x => x.file && x.status === 'pending');
        const convertOk = currentAction !== 'convert' || !!formatSelect.value;
        startBtn.disabled = !hasNewFiles || isProcessing || !convertOk;
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
        isProcessing = true;
        startBtn.disabled = true;
        startBtn.textContent = "Traitement en cours...";
        
        processNextInQueue(0).catch(() => {
            isProcessing = false;
            startBtn.textContent = "Lancer le traitement";
            updateUI();
        });
    });

    async function processNextInQueue(index) {
        if (index >= queue.length) {
            isProcessing = false;
            startBtn.disabled = false;
            startBtn.textContent = "Lancer le traitement";
            alert("Traitement de la file termine !");
            return;
        }

        const item = queue[index];
        if (item.status === 'done' || item.status === 'error' || item.existing) {
            processNextInQueue(index + 1);
            return;
        }

        const metaEl = item.element.querySelector('.file-meta');
        const barEl = item.element.querySelector('.progress-bar-fill');
        metaEl.textContent = "envoi...";
        barEl.style.width = "25%";

        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('action', currentAction);
        
        if (currentAction === 'convert') {
            formData.append('format', formatSelect.value);
        } else {
            const mode = document.querySelector('input[name="comp-mode"]:checked').value;
            formData.append('comp_mode', mode);
            
            let val = '';
            if (mode === 'crf') {
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
            const response = await fetch('/jobs', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();

            if (response.ok) {
                item.jobId = data.job_id;
                item.status = 'queued';
                barEl.style.width = "35%";
                metaEl.textContent = "en attente...";
                await pollJobUntilDone(item);
            } else {
                throw new Error(data.error);
            }
        } catch (error) {
            item.status = 'error';
            barEl.style.backgroundColor = "var(--danger)";
            metaEl.textContent = "Erreur: " + error.message;
            metaEl.style.color = "var(--danger)";
        }

        processNextInQueue(index + 1);
    }

    async function pollJobUntilDone(item) {
        const metaEl = item.element.querySelector('.file-meta');
        const barEl = item.element.querySelector('.progress-bar-fill');

        const jobId = item.jobId;
        if (!jobId) return;

        while (true) {
            const resp = await fetch(`/jobs/${jobId}`);
            const data = await resp.json();
            if (!resp.ok) {
                throw new Error(data.error || 'erreur');
            }

            if (data.status === 'queued') {
                metaEl.textContent = "en attente...";
                barEl.style.width = "40%";
            } else if (data.status === 'processing') {
                metaEl.textContent = "traitement...";
                barEl.style.width = "70%";
            } else if (data.status === 'done') {
                item.status = 'done';
                barEl.style.width = "100%";
                barEl.style.backgroundColor = "var(--success)";
                metaEl.textContent = "termine";
                metaEl.style.color = "var(--success)";

                const dlBtn = item.element.querySelector('.download-btn');
                dlBtn.href = data.download_url;
                dlBtn.classList.remove('hidden');
                if (data.output_filename) {
                    dlBtn.setAttribute('download', data.output_filename);
                }
                item.element.querySelector('.remove-btn').remove();
                return;
            } else if (data.status === 'error') {
                item.status = 'error';
                barEl.style.backgroundColor = "var(--danger)";
                metaEl.textContent = "erreur: " + (data.error || 'erreur');
                metaEl.style.color = "var(--danger)";
                return;
            }

            await sleep(1000);
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

            if(queue.length === 0) fileListEl.innerHTML = '';

            jobs.reverse().forEach(job => {
                const id = `job_${job.id}`;
                const clone = template.content.cloneNode(true);
                const el = clone.querySelector('.file-item');

                el.querySelector('.file-name').textContent = job.original_filename || job.id;
                el.querySelector('.file-meta').textContent = statusLabel(job.status, job.error);

                const barEl = el.querySelector('.progress-bar-fill');
                const metaEl = el.querySelector('.file-meta');

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

                el.querySelector('.remove-btn').addEventListener('click', () => removeFile(id));
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
        }
    }

    function statusLabel(status, error) {
        if (status === 'queued') return 'en attente';
        if (status === 'processing') return 'traitement';
        if (status === 'done') return 'termine';
        if (status === 'error') return 'erreur: ' + (error || 'erreur');
        return status || 'etat inconnu';
    }

    loadExistingJobs().catch(() => {});
});
