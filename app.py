import os
import subprocess
import shutil
import json
from flask import Flask, render_template, request, send_from_directory, jsonify
from werkzeug.utils import secure_filename
from pypdf import PdfReader, PdfWriter
from PIL import Image

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = os.path.abspath('uploads')
app.config['PROCESSED_FOLDER'] = os.path.abspath('processed')
app.config['MAX_CONTENT_LENGTH'] = 10000 * 1024 * 1024  # Limit 10GB

# Ensure directories exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(app.config['PROCESSED_FOLDER'], exist_ok=True)

def get_video_info(path):
    """Get video duration and bitrate using ffprobe."""
    try:
        cmd = [
            'ffprobe', '-v', 'error', '-select_streams', 'v:0',
            '-show_entries', 'format=duration,bit_rate:stream=width,height',
            '-of', 'json', path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        data = json.loads(result.stdout)
        
        duration = float(data['format'].get('duration', 0))
        bitrate = int(data['format'].get('bit_rate', 0))
        width = 0
        height = 0
        if 'streams' in data and len(data['streams']) > 0:
            width = int(data['streams'][0].get('width', 0))
            height = int(data['streams'][0].get('height', 0))
            
        return {'duration': duration, 'bitrate': bitrate, 'width': width, 'height': height}
    except Exception as e:
        print(f"Error reading metadata: {e}")
        return None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/process', methods=['POST'])
def process_file():
    file = request.files.get('file')
    action = request.form.get('action')
    target_format = request.form.get('format')
    
    # Advanced Compression Options
    comp_mode = request.form.get('comp_mode') # 'crf', 'size', 'percent', 'res'
    comp_value = request.form.get('comp_value') # Value associated with mode

    if not file or not file.filename:
        return jsonify({'error': 'No file uploaded'}), 400

    filename = secure_filename(file.filename)
    input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(input_path)

    base_name, ext = os.path.splitext(filename)
    ext = ext.lower()
    
    # Output filename
    if action == 'convert':
        output_filename = f"converted_{base_name}.{target_format}"
    else:
        output_filename = f"compressed_{base_name}{ext}"

    output_path = os.path.join(app.config['PROCESSED_FOLDER'], output_filename)

    try:
        # --- VIDEO & AUDIO HANDLING ---
        if ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.mp3', '.wav', '.flac', '.ogg', '.m4a']:
            cmd = ['ffmpeg', '-y', '-i', input_path]
            
            # Helper to detect type
            is_video = ext in ['.mp4', '.mkv', '.avi', '.mov', '.webm']

            if action == 'compress':
                if is_video:
                    cmd.extend(['-vcodec', 'libx264', '-preset', 'medium'])
                    
                    info = get_video_info(input_path)
                    
                    if comp_mode == 'size' and info and info['duration'] > 0:
                        # Target Size in MB
                        try:
                            target_size_mb = float(comp_value or 0)
                        except ValueError:
                            target_size_mb = 0
                            
                        if target_size_mb > 0:
                            target_bitrate = int((target_size_mb * 8 * 1024 * 1024) / info['duration'])
                            # Safety: Don't go below 100k
                            target_bitrate = max(target_bitrate, 100000)
                            cmd.extend(['-b:v', str(target_bitrate)])
                        else:
                             # Fallback to default CRF if size invalid
                             cmd.extend(['-crf', '23'])
                        
                    elif comp_mode == 'percent' and info and info['bitrate'] > 0:
                        # Percentage reduction (e.g., 50 means 50% size)
                        try:
                            percent = float(comp_value or 0)
                        except ValueError:
                            percent = 0
                            
                        if percent > 0:
                            target_bitrate = int(info['bitrate'] * (1 - percent/100))
                            target_bitrate = max(target_bitrate, 100000)
                            cmd.extend(['-b:v', str(target_bitrate)])
                        else:
                             cmd.extend(['-crf', '23'])
                        
                    elif comp_mode == 'res':
                        target_height = comp_value or '720'
                        cmd.extend(['-vf', f'scale=-2:{target_height}', '-crf', '23'])
                        
                    else:
                        # Default CRF Mode
                        crf_map = {'low': '23', 'medium': '28', 'high': '35'}
                        val = comp_value or 'medium'
                        crf = crf_map.get(val, '23')
                        cmd.extend(['-crf', crf])

                else:
                    # Audio Compression
                    cmd.extend(['-b:a', '128k'])

            elif action == 'convert':
                # FFmpeg auto-conversion
                pass

            cmd.append(output_path)
            subprocess.run(cmd, check=True, stderr=subprocess.PIPE)

        # --- PDF HANDLING ---
        elif ext == '.pdf':
            if action == 'compress':
                reader = PdfReader(input_path)
                writer = PdfWriter()
                
                for page in reader.pages:
                    writer.add_page(page)
                    page.compress_content_streams()
                
                if comp_value == 'high':
                     writer.add_metadata({})
                else:
                    if reader.metadata:
                        writer.add_metadata(reader.metadata)

                with open(output_path, "wb") as f:
                    writer.write(f)
            
            elif action == 'convert':
                 if target_format == 'txt':
                    reader = PdfReader(input_path)
                    text = ""
                    for page in reader.pages:
                        t = page.extract_text()
                        if t: text += t + "\n"
                    with open(output_path, "w") as f:
                        f.write(text)
                 else:
                     return jsonify({'error': 'Conversion PDF vers ce format non supportée'}), 400

        # --- IMAGE HANDLING ---
        elif ext in ['.jpg', '.jpeg', '.png', '.webp', '.bmp']:
            img = Image.open(input_path)
            
            if action == 'compress':
                q_map = {'low': 85, 'medium': 60, 'high': 30}
                val = comp_value or 'medium'
                quality = q_map.get(val, 60)
                
                if comp_mode == 'percent':
                     try:
                        p_val = float(comp_value or 0)
                        quality = max(10, 100 - int(p_val))
                     except ValueError:
                        pass
                
                img.save(output_path, quality=quality, optimize=True)
            
            elif action == 'convert':
                if target_format == 'pdf':
                    if img.mode == 'RGBA': img = img.convert('RGB')
                    img.save(output_path, "PDF", resolution=100.0)
                else:
                    if target_format in ['jpg', 'jpeg'] and img.mode == 'RGBA':
                        img = img.convert('RGB')
                    img.save(output_path)
        else:
             return jsonify({'error': 'Format non supporté'}), 400

        return jsonify({
            'success': True,
            'download_url': f'/download/{os.path.basename(output_filename)}',
            'filename': os.path.basename(output_filename)
        })

    except Exception as e:
        print(e)
        return jsonify({'error': str(e)}), 500

@app.route('/download/<filename>')
def download_file(filename):
    return send_from_directory(app.config['PROCESSED_FOLDER'], filename, as_attachment=True)

if __name__ == '__main__':
    app.run(debug=True, port=5001)
