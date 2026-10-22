const API_BASE = window.API_BASE || '';
const TOKEN_KEY = 'cloudnest_token';
const USER_KEY = 'cloudnest_user';
let currentView = 'overview';
let currentUser = null;
let currentFolder = null;
let searchTerm = '';

const $ = id => document.getElementById(id);
const token = () => localStorage.getItem(TOKEN_KEY);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const formatSize = n => { if (!n) return '0 B'; const u=['B','KB','MB','GB','TB']; let i=0,x=Number(n); while(x>=1024&&i<u.length-1){x/=1024;i++} return `${x.toFixed(x>=10||i===0?0:1)} ${u[i]}`; };
const formatDate = d => new Date(d).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
const formatRelative = d => { const diff=Date.now()-new Date(d).getTime(); const m=Math.floor(diff/60000); if(m<1)return 'Just now'; if(m<60)return `${m}m ago`; const h=Math.floor(m/60); if(h<24)return `${h}h ago`; const days=Math.floor(h/24); if(days<7)return `${days}d ago`; return formatDate(d); };
const fileIcon = (type='',name='') => { const n=name.toLowerCase(),t=type.toLowerCase(); if(t.includes('image'))return '🖼️'; if(t.includes('pdf')||n.endsWith('.pdf'))return '📕'; if(t.includes('zip')||t.includes('compressed')||n.endsWith('.zip'))return '📦'; if(t.includes('video'))return '🎬'; if(t.includes('audio'))return '🎵'; if(t.includes('spreadsheet')||t.includes('excel'))return '📊'; if(t.includes('word')||t.includes('document'))return '📝'; return '📄'; };
function toast(message,error=false){const el=$('toast');el.textContent=message;el.className='toast show'+(error?' error':'');clearTimeout(toast.t);toast.t=setTimeout(()=>el.className='toast',3200);}
async function api(path,options={}){const headers={...(options.headers||{})};if(options.body&&!(options.body instanceof FormData))headers['Content-Type']='application/json';if(token())headers.Authorization=`Bearer ${token()}`;const r=await fetch(API_BASE+path,{...options,headers});let d={};try{d=await r.json()}catch{}if(!r.ok)throw new Error(d.error||d.errors?.[0]?.msg||`Request failed (${r.status})`);return d;}
function showLanding(){$('landing').classList.remove('hidden');$('authView').classList.add('hidden');$('appView').classList.add('hidden');}
function showAuth(mode='login'){$('landing').classList.add('hidden');$('appView').classList.add('hidden');$('authView').classList.remove('hidden');['authLogin','authRegister','authForgot','authReset'].forEach((id,i)=>$(id).classList.toggle('hidden',['login','register','forgot','reset'][i]!==mode));}
function updateUserUI(){if(!currentUser)return;const initial=(currentUser.name||'U')[0].toUpperCase();['avatarSmall','avatarTop'].forEach(id=>$(id).textContent=initial);$('sideName').textContent=currentUser.name;$('sideEmail').textContent=currentUser.email;$('topName').textContent=currentUser.name;}
function showApp(){$('landing').classList.add('hidden');$('authView').classList.add('hidden');$('appView').classList.remove('hidden');updateUserUI();navigate('overview');}
function setActive(view){document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('sidebar').classList.remove('open');}

function actionButtons(file, trash = false) {
    const id = esc(file._id);

    if (trash) {
        return `
            <button class="small-btn" title="Restore"
                onclick="restoreFile('${id}')">↩</button>
            <button class="small-btn danger" title="Delete permanently"
                onclick="deleteFile('${id}')">×</button>
        `;
    }

    return `
        <button class="small-btn" title="Open"
            onclick="openFile('${id}')">↗</button>

        <button class="small-btn" title="Download"
            onclick="downloadFile('${id}', ${esc(JSON.stringify(file.name || 'download'))})">⬇</button>

        <button class="small-btn" title="Rename"
            onclick="renameFile('${id}', ${esc(JSON.stringify(file.name))})">✎</button>

        <button class="small-btn" title="${file.isStarred ? 'Unstar' : 'Star'}"
            onclick="toggleStar('${id}', ${!file.isStarred})">
            ${file.isStarred ? '★' : '☆'}
        </button>

        <button class="small-btn" title="Share"
            onclick="shareFile('${id}')">⌯</button>

        <button class="small-btn" title="Version history"
            onclick="fileVersions('${id}')">◷</button>

        <button class="small-btn" title="Move"
            onclick="moveFile('${id}')">↪</button>

        <button class="small-btn danger" title="Move to trash"
            onclick="trashFile('${id}')">⌫</button>
    `;
}

function fileTable(files,trash=false){if(!files.length)return `<div class="empty"><div class="empty-icon">${trash?'🗑️':'☁️'}</div><b>${trash?'Trash is empty':'Nothing here yet'}</b><p>${trash?'Deleted files will stay here until you remove them permanently.':'Upload a file or create a folder to start building your workspace.'}</p></div>`;return `<div class="table-wrap"><table class="file-table"><thead><tr><th>Name</th><th>Type</th><th>Folder</th><th>Size</th><th>Updated</th><th></th></tr></thead><tbody>${files.map(f=>`<tr><td><div class="file-name"><span class="file-icon">${fileIcon(f.type,f.name)}</span><div><b>${esc(f.name)}</b>${f.storageProvider?`<small class="file-url">${esc(f.storageProvider)} storage</small>`:''}</div></div></td><td><span class="tag">${esc(f.extension||f.type||'file')}</span></td><td>${esc(f.folder?.name||'My files')}</td><td>${formatSize(f.size)}</td><td>${formatRelative(f.updatedAt)}</td><td><div class="row-actions">${actionButtons(f,trash)}</div></td></tr>`).join('')}</tbody></table></div>`;}
async function renderOverview(){const d=(await api('/api/dashboard/stats')).data;const pct=d.storageLimit?Math.min(100,d.storageUsed/d.storageLimit*100):0;$('storageMini').textContent=`${formatSize(d.storageUsed)} / ${formatSize(d.storageLimit)}`;$('viewContent').innerHTML=`<div class="page-head"><div><span class="eyebrow">OVERVIEW</span><h1>Good to see you, ${esc(currentUser.name.split(' ')[0])} 👋</h1><p>Your workspace at a glance.</p></div><button class="btn btn-primary" onclick="openNewFile()">＋ Upload file</button></div><div class="stats"><div class="stat"><div class="stat-top"><span>Total files</span><span class="stat-icon">▣</span></div><strong>${d.files}</strong></div><div class="stat"><div class="stat-top"><span>Folders</span><span class="stat-icon">▱</span></div><strong>${d.folders}</strong></div><div class="stat"><div class="stat-top"><span>Starred</span><span class="stat-icon">★</span></div><strong>${d.starred}</strong></div><div class="stat"><div class="stat-top"><span>Storage used</span><span class="stat-icon">☁</span></div><strong>${formatSize(d.storageUsed)}</strong><div class="progress"><i style="width:${pct}%"></i></div><small style="color:var(--muted)">${formatSize(d.storageLimit)} available</small></div></div><div class="section-card"><div class="section-head"><h2>Recent files</h2><button class="btn btn-ghost" onclick="navigate('files')">View all →</button></div>${fileTable(d.recent)}</div>`;}
async function renderFiles(view,search=''){const trash=view==='trash',starred=view==='starred';let folderQs='';if(view==='files'&&currentFolder)folderQs=`&folder=${encodeURIComponent(currentFolder)}`;const qs=new URLSearchParams({trash:String(trash),starred:String(starred),page:'1',limit:'50'});if(search)qs.set('search',search);if(view==='files'&&currentFolder)qs.set('folder',currentFolder);const d=(await api(`/api/files?${qs.toString()}`)).data;let title=trash?'Trash':starred?'Starred files':search?'Search results':currentFolder?'Folder contents':'My files';$('viewContent').innerHTML=`<div class="page-head"><div><span class="eyebrow">${trash?'RECOVERY':starred?'BOOKMARKS':'FILES'}</span><h1>${title}</h1><p>${trash?'Restore or permanently remove deleted files.':starred?'Your important files in one place.':'Browse, organize and manage your files.'}</p></div>${!trash?'<button class="btn btn-primary" onclick="openNewFile()">＋ Upload file</button>':''}</div>${currentFolder&&view==='files'?await folderCrumbs(currentFolder):''}<div class="section-card"><div class="section-head"><h2>${d.length} file${d.length===1?'':'s'}</h2></div>${fileTable(d,trash)}</div>`;}
async function folderCrumbs(id){const d=(await api(`/api/folders/${id}/breadcrumbs`)).data;return `<div class="breadcrumbs"><button onclick="clearFolder()">My files</button>${d.map(x=>`<span>›</span><button onclick="openFolder('${x.id}')">${esc(x.name)}</button>`).join('')}</div>`;}
async function getAllFolders(){const rows=(await api('/api/folders?all=true')).data;const childrenOf=parent=>rows.filter(folder=>String(folder.parentFolder||'')===String(parent||'')).sort((a,b)=>a.name.localeCompare(b.name));const flatten=(parent=null,depth=0)=>childrenOf(parent).flatMap(folder=>[{...folder,depth},...flatten(String(folder._id),depth+1)]);return flatten();}
async function renderFolders(){const parent=currentFolder;const qs=parent?`?parent=${parent}`:'';const folders=(await api('/api/folders'+qs)).data;const files=currentFolder?(await api(`/api/files?folder=${currentFolder}&limit=50`)).data:[];$('viewContent').innerHTML=`<div class="page-head"><div><span class="eyebrow">ORGANIZE</span><h1>Folders</h1><p>Create folders and keep projects easy to find.</p></div><button class="btn btn-primary" onclick="openNewFolder()">＋ New folder</button></div>${currentFolder?await folderCrumbs(currentFolder):''}<div class="folder-grid">${folders.length?folders.map(f=>`<div class="folder-card" ondblclick="openFolder('${f._id}')"><span class="file-icon">📁</span><div class="folder-main"><b>${esc(f.name)}</b><small>Created ${formatDate(f.createdAt)}</small></div><button class="small-btn" title="Open" onclick="openFolder('${f._id}')">→</button><button class="small-btn" title="Rename" onclick="renameFolder('${f._id}',${esc(JSON.stringify(f.name))})">✎</button><button class="small-btn" title="Move folder" onclick="moveFolder('${f._id}')">↪</button><button class="small-btn danger" title="Delete" onclick="deleteFolder('${f._id}')">×</button></div>`).join(''):'<div class="empty"><div class="empty-icon">📁</div><b>No subfolders here</b><p>Create a folder to organize this area.</p></div>'}</div>${currentFolder?`<div class="section-card" style="margin-top:18px"><div class="section-head"><h2>Files in this folder</h2></div>${fileTable(files)}</div>`:''}`;}
async function renderRecent(){const d=(await api('/api/files?limit=50')).data;$('viewContent').innerHTML=`<div class="page-head"><div><span class="eyebrow">ACTIVITY</span><h1>Recent files</h1><p>The latest files you've added or changed.</p></div></div><div class="section-card">${fileTable(d)}</div>`;}
async function renderSettings(){const me=(await api('/api/me')).data;currentUser=me;updateUserUI();const pct=me.storageLimit?Math.min(100,me.storageUsed/me.storageLimit*100):0;$('viewContent').innerHTML=`<div class="page-head"><div><span class="eyebrow">ACCOUNT</span><h1>Settings</h1><p>Manage your CloudNest account and workspace.</p></div></div><div class="settings-grid"><div class="settings-card"><h3>Profile</h3><form id="profileForm"><label>Full name<input value="${esc(me.name)}" disabled></label><label>Email<input value="${esc(me.email)}" disabled></label></form></div><div class="settings-card"><h3>Storage</h3><div class="storage-big"><strong>${formatSize(me.storageUsed)}</strong> <span>of ${formatSize(me.storageLimit)} used</span><div class="progress"><i style="width:${pct}%"></i></div></div><p>Storage usage updates when files are uploaded or permanently deleted. Files in Trash still use storage.</p></div><div class="settings-card"><h3>Session</h3><p>You're signed in as <b>${esc(me.email)}</b>. Sign out from this device when you're finished.</p><button class="btn btn-primary" onclick="logout()">Sign out</button></div></div>`;}
async function navigate(view,search=''){currentView=view;if(!['files','folders'].includes(view))currentFolder=null;if(search!==undefined)searchTerm=search;setActive(view);try{if(view==='overview')await renderOverview();else if(['files','starred','trash'].includes(view))await renderFiles(view,searchTerm);else if(view==='folders')await renderFolders();else if(view==='recent')await renderRecent();else await renderSettings();}catch(e){toast(e.message,true);}}
function openModal(html){$('modalContent').innerHTML=html;$('modal').classList.remove('hidden');}function closeModal(){$('modal').classList.add('hidden');}
async function openNewFolder(){openModal(`<div class="modal-eyebrow">ORGANIZE</div><h2>New folder</h2><p>Create a folder${currentFolder?' inside the current folder':''}.</p><form id="newFolderForm"><label>Folder name<input id="newFolderName" maxlength="100" placeholder="e.g. Project files" required></label><div class="form-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary">Create folder</button></div></form>`);$('newFolderForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/folders',{method:'POST',body:JSON.stringify({name:$('newFolderName').value,parentFolder:currentFolder||null})});closeModal();toast('Folder created');navigate('folders')}catch(err){toast(err.message,true)}};}
async function openNewFile(){let folders;try{folders=await getAllFolders()}catch(err){toast(err.message,true);return}openModal(`<div class="modal-eyebrow">UPLOAD</div><h2>Upload a file</h2><p>Choose a file from your device. CloudNest stores its metadata and sends the file to your configured storage provider.</p><form id="newFileForm"><label class="upload-zone" id="uploadZone"><input id="newFileInput" type="file" hidden required><span class="upload-cloud">☁</span><b id="uploadLabel">Choose a file</b><small>or drag and drop · max 50 MB</small></label><div id="selectedFile" class="selected-file hidden"></div><label>Folder<select id="newFileFolder"><option value="">My files</option>${folders.map(f=>`<option value="${f._id}" ${currentFolder===String(f._id)?'selected':''}>${'— '.repeat(f.depth)}${esc(f.name)}</option>`).join('')}</select></label><div class="form-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button id="uploadSubmit" class="btn btn-primary">Upload file</button></div><div id="uploadProgress" class="upload-progress hidden"><i></i></div></form>`);const input=$('newFileInput'),zone=$('uploadZone'),label=$('uploadLabel'),selected=$('selectedFile');const showFile=file=>{if(!file)return;label.textContent=file.name;selected.classList.remove('hidden');selected.innerHTML=`<span>${fileIcon(file.type,file.name)}</span><div><b>${esc(file.name)}</b><small>${formatSize(file.size)} · ${esc(file.type||'Unknown type')}</small></div>`;};zone.onclick=e=>{if(e.target!==input)input.click()};input.onchange=()=>showFile(input.files[0]);zone.ondragover=e=>{e.preventDefault();zone.classList.add('dragging')};zone.ondragleave=()=>zone.classList.remove('dragging');zone.ondrop=e=>{e.preventDefault();zone.classList.remove('dragging');if(e.dataTransfer.files[0]){try{const dt=new DataTransfer();dt.items.add(e.dataTransfer.files[0]);input.files=dt.files}catch{}showFile(e.dataTransfer.files[0])}};$('newFileForm').onsubmit=async e=>{e.preventDefault();const file=input.files[0];if(!file){toast('Choose a file first',true);return}const progress=$('uploadProgress'),submit=$('uploadSubmit');submit.disabled=true;progress.classList.remove('hidden');try{const form=new FormData();form.append('file',file);if($('newFileFolder').value)form.append('folder',$('newFileFolder').value);await api('/api/files/upload',{method:'POST',body:form});closeModal();toast('File uploaded successfully');navigate(currentView)}catch(err){toast(err.message,true);submit.disabled=false;progress.classList.add('hidden')}};}
async function shareFile(id){openModal(`<div class="modal-eyebrow">SHARE</div><h2>Create a share link</h2><p>Anyone with the link can access the file until it expires.</p><form id="shareForm"><label>Link expires in<select id="shareDays"><option value="1">1 day</option><option value="7" selected>7 days</option><option value="30">30 days</option></select></label><div class="form-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary">Create link</button></div></form>`);$('shareForm').onsubmit=async e=>{e.preventDefault();try{const d=(await api(`/api/files/${id}/share`,{method:'POST',body:JSON.stringify({expiresInDays:Number($('shareDays').value)})})).data;openModal(`<div class="modal-eyebrow">SHARE LINK READY</div><h2>Your link is ready</h2><p>Copy this link and send it to someone you trust.</p><input id="shareLink" value="${esc(d.url)}" readonly><div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Done</button><button class="btn btn-primary" onclick="copyShareLink()">Copy link</button></div><p style="font-size:11px;margin-top:12px">Expires ${formatDate(d.expiresAt)}.</p>`)}catch(err){toast(err.message,true)}};}
window.copyShareLink=async()=>{try{await navigator.clipboard.writeText($('shareLink').value);toast('Share link copied')}catch{const field=$('shareLink');field.select();toast('Select and copy the link manually',true)}};
window.fileVersions=async id=>{
  try {
    const data=(await api(`/api/files/${id}/versions`)).data;
    const rows=data.length?data.map(v=>`<div class="version-row"><div><b>${esc(v.name)}</b><small>${formatDate(v.createdAt)} · ${formatSize(v.size)}</small></div><button class="btn btn-ghost" onclick="restoreVersion('${id}','${v._id}')">Restore</button></div>`).join(''):'<p>No previous versions yet. Upload a new version to start history.</p>';
    openModal(`<div class="modal-eyebrow">FILE HISTORY</div><h2>Version history</h2><div class="version-list">${rows}</div><form id="versionUploadForm"><label>Upload a new version<input id="versionInput" type="file" required></label><div class="form-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Close</button><button class="btn btn-primary">Upload version</button></div></form>`);
    $('versionUploadForm').onsubmit=async e=>{e.preventDefault();const f=$('versionInput').files[0];if(!f)return;const form=new FormData();form.append('file',f);try{await api(`/api/files/${id}/versions`,{method:'POST',body:form});toast('New version uploaded');await fileVersions(id);navigate(currentView)}catch(err){toast(err.message,true)}};
  } catch(e) { toast(e.message,true); }
};
window.restoreVersion=async(fileId,versionId)=>{if(!confirm('Restore this version? The current version will be kept in history.'))return;try{await api(`/api/files/${fileId}/versions/${versionId}/restore`,{method:'POST'});toast('Version restored');closeModal();navigate(currentView)}catch(e){toast(e.message,true)}};
window.openFile=async id=>{const tab=window.open('about:blank','_blank');if(!tab){toast('Allow pop-ups to open files',true);return}try{const r=await fetch(`${API_BASE}/api/files/${id}/download`,{headers:{Authorization:`Bearer ${token()}`}});if(!r.ok){let d={};try{d=await r.json()}catch{}throw new Error(d.error||'Unable to open file')}if(r.headers.get('X-CloudNest-External')==='true'){const d=await r.json();if(!d.data?.url)throw new Error('File URL is unavailable');tab.location.href=d.data.url;return}const blob=await r.blob();const objectUrl=URL.createObjectURL(blob);tab.location.href=objectUrl;setTimeout(()=>URL.revokeObjectURL(objectUrl),60000)}catch(e){tab.close();toast(e.message,true)}};
window.downloadFile = async (id, filename = 'download') => {
    try {
        const response = await fetch(
            `${API_BASE}/api/files/${id}/download`,
            {
                headers: {
                    Authorization: `Bearer ${token()}`
                }
            }
        );

        if (!response.ok) {
            let data = {};

            try {
                data = await response.json();
            } catch {}

            throw new Error(
                data.error || 'Unable to download file'
            );
        }

        // Handle files stored externally on Cloudinary
        if (response.headers.get('X-CloudNest-External') === 'true') {
            const data = await response.json();

            if (!data.data?.url) {
                throw new Error('File URL is unavailable');
            }

            let url = data.data.url;

            // Request attachment delivery for supported Cloudinary URLs
            if (
                url.includes('res.cloudinary.com') &&
                url.includes('/upload/') &&
                !url.includes('/s--')
            ) {
                url = url.replace(
                    '/upload/',
                    '/upload/fl_attachment/'
                );
            }

            const link = document.createElement('a');
            link.href = url;
            link.download = filename || 'download';
            link.rel = 'noopener';

            document.body.appendChild(link);
            link.click();
            link.remove();

            toast('Download started');
            return;
        }

        // Handle files returned directly by the backend
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);

        const disposition =
            response.headers.get('Content-Disposition') || '';

        const match = disposition.match(
            /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i
        );

        const actualName = match
            ? (
                match[1]
                    ? decodeURIComponent(match[1])
                    : match[2]
            )
            : (filename || 'download');

        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = actualName;

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => {
            URL.revokeObjectURL(objectUrl);
        }, 60000);

        toast('Download started');

    } catch (error) {
        toast(error.message || 'Unable to download file', true);
    }
};


window.renameFile=async(id,current)=>{const name=prompt('New file name',current);if(!name||name.trim()===current.trim())return;try{await api(`/api/files/${id}/rename`,{method:'PATCH',body:JSON.stringify({name:name.trim()})});toast('File renamed');navigate(currentView)}catch(e){toast(e.message,true)}};
window.moveFile=async id=>{let folders;try{folders=await getAllFolders()}catch(e){toast(e.message,true);return}openModal(`<div class="modal-eyebrow">ORGANIZE</div><h2>Move file</h2><form id="moveForm"><label>Destination<select id="moveFolder"><option value="">My files</option>${folders.map(f=>`<option value="${f._id}">${'— '.repeat(f.depth)}${esc(f.name)}</option>`).join('')}</select></label><div class="form-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary">Move file</button></div></form>`);$('moveForm').onsubmit=async e=>{e.preventDefault();try{await api(`/api/files/${id}/move`,{method:'PATCH',body:JSON.stringify({folder:$('moveFolder').value||null})});closeModal();toast('File moved');navigate(currentView)}catch(err){toast(err.message,true)}}};
window.moveFolder=async id=>{
  let folders;
  try{folders=await getAllFolders()}catch(e){toast(e.message,true);return}
  const source=folders.find(f=>String(f._id)===String(id));
  if(!source){toast('Folder not found',true);return}
  const blocked=new Set([String(id)]);
  let changed=true;
  while(changed){changed=false;for(const f of folders){if(f.parentFolder&&blocked.has(String(f.parentFolder))&&!blocked.has(String(f._id))){blocked.add(String(f._id));changed=true}}}
  const destinations=folders.filter(f=>!blocked.has(String(f._id)));
  openModal(`<div class="modal-eyebrow">ORGANIZE</div><h2>Move folder</h2><p>Choose where to move <b>${esc(source.name)}</b>. Its contents will move with it.</p><form id="moveFolderForm"><label>Destination<select id="moveFolderParent"><option value="" ${!source.parentFolder?'selected':''}>My files (root)</option>${destinations.map(f=>`<option value="${f._id}" ${String(source.parentFolder||'')===String(f._id)?'selected':''}>${'— '.repeat(f.depth)}${esc(f.name)}</option>`).join('')}</select></label><div class="form-actions"><button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button><button class="btn btn-primary">Move folder</button></div></form>`);
  $('moveFolderForm').onsubmit=async e=>{e.preventDefault();try{await api(`/api/folders/${id}`,{method:'PATCH',body:JSON.stringify({parentFolder:$('moveFolderParent').value||null})});closeModal();toast('Folder moved');navigate('folders')}catch(err){toast(err.message,true)}};
};
window.deleteFolder=async id=>{if(!confirm('Delete this folder and everything inside it?'))return;try{await api(`/api/folders/${id}`,{method:'DELETE'});currentFolder=null;toast('Folder deleted');navigate('folders')}catch(e){toast(e.message,true)}};
window.renameFolder=async(id,current)=>{const name=prompt('New folder name',current);if(!name||name.trim()===current.trim())return;try{await api(`/api/folders/${id}`,{method:'PATCH',body:JSON.stringify({name:name.trim()})});toast('Folder renamed');navigate('folders')}catch(e){toast(e.message,true)}};
window.deleteFile=async id=>{if(!confirm('Permanently delete this file? This cannot be undone.'))return;try{await api(`/api/files/${id}`,{method:'DELETE'});toast('File permanently deleted');navigate(currentView)}catch(e){toast(e.message,true)}};
window.trashFile=async id=>{try{await api(`/api/files/${id}/trash`,{method:'PATCH'});toast('Moved to trash');navigate(currentView)}catch(e){toast(e.message,true)}};
window.restoreFile=async id=>{try{await api(`/api/files/${id}/restore`,{method:'PATCH'});toast('File restored');navigate('files')}catch(e){toast(e.message,true)}};
window.toggleStar=async(id,starred)=>{try{await api(`/api/files/${id}/star`,{method:'PATCH',body:JSON.stringify({starred})});toast(starred?'Added to starred':'Removed from starred');navigate(currentView)}catch(e){toast(e.message,true)}};
window.openFolder=id=>{currentFolder=id;currentView='folders';searchTerm='';setActive('folders');renderFolders().catch(e=>toast(e.message,true))};window.clearFolder=()=>{currentFolder=null;currentView='folders';setActive('folders');renderFolders().catch(e=>toast(e.message,true))};
window.logout=()=>{localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY);currentUser=null;currentFolder=null;showLanding();toast('Signed out');};
$('loginForm').onsubmit=async e=>{e.preventDefault();try{const d=(await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:$('loginEmail').value,password:$('loginPassword').value})})).data;localStorage.setItem(TOKEN_KEY,d.accessToken);localStorage.setItem(USER_KEY,JSON.stringify(d.user));currentUser=d.user;toast('Welcome back');showApp()}catch(e){toast(e.message,true)}};
$('registerForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/auth/register',{method:'POST',body:JSON.stringify({name:$('regName').value,email:$('regEmail').value,password:$('regPassword').value})});toast('Account created — sign in');showAuth('login');$('loginEmail').value=$('regEmail').value}catch(e){toast(e.message,true)}};
$('forgotForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email:$('forgotEmail').value.trim()})});toast('If the account exists, reset instructions will be sent');}catch(err){toast(err.message,true)}};
$('resetForm').onsubmit=async e=>{e.preventDefault();const password=$('resetPassword').value;if(password!==$('resetPasswordConfirm').value){toast('Passwords do not match',true);return}const resetToken=new URLSearchParams(window.location.search).get('resetToken');if(!resetToken){toast('Reset link is missing. Request a new one.',true);showAuth('forgot');return}try{await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token:resetToken,password})});history.replaceState({},document.title,window.location.pathname);localStorage.removeItem(TOKEN_KEY);localStorage.removeItem(USER_KEY);currentUser=null;$('resetPassword').value='';$('resetPasswordConfirm').value='';toast('Password updated. Please sign in.');showAuth('login')}catch(err){toast(err.message,true)}};
document.addEventListener('click',e=>{const b=e.target.closest('[data-auth]');if(b)showAuth(b.dataset.auth);const nav=e.target.closest('[data-view]');if(nav){if(['files','folders'].includes(nav.dataset.view))currentFolder=null;searchTerm='';$('searchInput').value='';navigate(nav.dataset.view,'');}});
$('backHome').onclick=showLanding;$('closeModal').onclick=closeModal;$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal()});$('newBtn').onclick=()=>openNewFile();$('profileBtn').onclick=()=>navigate('settings');$('topProfile').onclick=()=>navigate('settings');$('menuBtn').onclick=()=>$('sidebar').classList.toggle('open');$('closeSidebar').onclick=()=>$('sidebar').classList.remove('open');let searchTimer; $('searchInput').oninput=e=>{clearTimeout(searchTimer);const value=e.target.value.trim();searchTimer=setTimeout(()=>{currentFolder=null;navigate('files',value)},250)}; $('searchInput').onkeydown=e=>{if(e.key==='Enter'){clearTimeout(searchTimer);currentFolder=null;navigate('files',e.target.value.trim())}};
(async()=>{const resetToken=new URLSearchParams(window.location.search).get('resetToken');if(resetToken){showAuth('reset');return}const saved=localStorage.getItem(USER_KEY);if(token()&&saved){try{currentUser=(await api('/api/me')).data;showApp()}catch{logout()}}else showLanding()})();
