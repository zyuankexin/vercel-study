/* ============================================
   Aurhythm — 音乐播放器 核心逻辑
   播放控制 / 可视化 / 播放列表 / 键盘快捷键
   ============================================ */

(function () {
  'use strict';

  // ========== DOM 缓存 ==========
  const $ = (id) => document.getElementById(id);

  const audio          = $('audioPlayer');
  const artWrapper     = $('artWrapper');
  const artDisc        = $('artDisc');
  const trackTitle     = $('trackTitle');
  const trackArtist    = $('trackArtist');
  const progressBar    = $('progressBar');
  const progressFill   = $('progressFill');
  const currentTimeEl  = $('currentTime');
  const durationEl     = $('duration');
  const btnPlay        = $('btnPlay');
  const iconPlay       = $('iconPlay');
  const iconPause      = $('iconPause');
  const btnPrev        = $('btnPrev');
  const btnNext        = $('btnNext');
  const btnShuffle     = $('btnShuffle');
  const btnRepeat      = $('btnRepeat');
  const volumeSlider   = $('volumeSlider');
  const volumeFill     = $('volumeFill');
  const volumeIcon     = $('volumeIcon');
  const playlistList   = $('playlistList');
  const searchInput    = $('searchInput');
  const fileUpload     = $('fileUpload');
  const toast          = $('toast');
  const playerMain     = $('playerMain');
  const visualizerEl   = $('visualizer');

  // ========== AudioContext & 可视化 ==========
  let audioCtx   = null;
  let analyser   = null;
  let source     = null;
  let vizBars    = [];
  let vizAnimId  = null;

  function initAudioContext() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
  }

  function createVisualizerBars() {
    visualizerEl.innerHTML = '';
    vizBars = [];
    const count = Math.min(64, analyser.frequencyBinCount);
    for (let i = 0; i < count; i++) {
      const bar = document.createElement('div');
      bar.className = 'visualizer-bar';
      visualizerEl.appendChild(bar);
      vizBars.push(bar);
    }
  }

  function updateVisualizer() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const step = Math.floor(data.length / vizBars.length);
    for (let i = 0; i < vizBars.length; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
      vizBars[i].style.height = Math.max(3, (sum / step / 255) * 60) + 'px';
    }
    vizAnimId = requestAnimationFrame(updateVisualizer);
  }

  function startVisualizer() {
    if (!audioCtx || audioCtx.state === 'suspended') audioCtx?.resume();
    if (analyser && !vizBars.length) createVisualizerBars();
    if (!vizAnimId) updateVisualizer();
  }

  function stopVisualizer() {
    if (vizAnimId) { cancelAnimationFrame(vizAnimId); vizAnimId = null; }
    vizBars.forEach((b) => (b.style.height = '3px'));
  }

  // ========== Supabase 初始化 ==========
  // 请替换为你自己的 Supabase 项目 URL 和 anon key
  const SUPABASE_URL = 'YOUR_SUPABASE_URL';
  const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

  let supabaseClient = null;
  if (typeof window.supabase !== 'undefined' && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  // ========== 数据模型 ==========
  // 当 Supabase 不可用时的本地备用数据
  const fallbackPlaylist = [
    { id: '1', title: '星空下的漫步', artist: 'Lune Blanche',  duration: '3:42', color: '#1a2a4a' },
    { id: '2', title: '城市夜曲',     artist: 'Neon Pulse',   duration: '4:15', color: '#2a1a3a' },
    { id: '3', title: '雨中即景',     artist: 'Violet Rain',  duration: '2:58', color: '#1a3a3a' },
    { id: '4', title: '远方的风',     artist: 'Horizon',      duration: '5:03', color: '#3a2a1a' },
    { id: '5', title: '午夜蓝调',     artist: 'Blue Hour',    duration: '3:31', color: '#1a1a3a' },
    { id: '6', title: '晨光熹微',     artist: 'Aurora Dawn',  duration: '4:47', color: '#3a3a1a' },
    { id: '7', title: '思绪漂流',     artist: 'Mindwave',     duration: '3:18', color: '#2a3a1a' },
    { id: '8', title: '黄昏咖啡馆',   artist: 'Golden Hour',  duration: '4:02', color: '#3a1a2a' },
  ];

  let playlist     = [];

  // 从 Supabase 加载歌曲列表
  async function fetchSongs() {
    if (!supabaseClient) {
      console.warn('Supabase 未配置，使用本地备用数据');
      return [...fallbackPlaylist];
    }

    const { data, error } = await supabaseClient.from('songs').select('*');

    if (error) {
      console.error('Supabase 查询失败:', error.message);
      showToast('加载歌曲失败，使用本地数据');
      return [...fallbackPlaylist];
    }

    if (!data || data.length === 0) {
      console.warn('Supabase 返回空数据，使用本地备用数据');
      return [...fallbackPlaylist];
    }

    return data.map(function (song) {
      return {
        id:        song.id,
        title:     song.title     || '未知曲目',
        artist:    song.artist    || '未知艺术家',
        duration:  song.duration  || '--:--',
        color:     song.color     || '#1a1a3e',
        coverUrl:  song.cover_url || null,
        src:       song.src       || null,
      };
    });
  }
  let currentIndex = -1;
  let isShuffle    = false;
  let repeatMode   = 0; // 0=off, 1=all, 2=one
  let shuffleOrder = [];

  // ========== 工具函数 ==========
  function formatTime(sec) {
    if (isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  let toastTimer;
  function showToast(msg) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  }

  function generateShuffleOrder() {
    const arr = Array.from({ length: playlist.length }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr[0] === currentIndex && arr.length > 1) {
      [arr[0], arr[1]] = [arr[1], arr[0]];
    }
    return arr;
  }

  // ========== 播放状态切换 ==========
  function setPlayingState(playing) {
    iconPlay.style.display  = playing ? 'none'  : 'block';
    iconPause.style.display = playing ? 'block' : 'none';
    artWrapper.classList.toggle('spinning', playing);
    if (playing) {
      startVisualizer();
      if (!audioCtx || audioCtx.state === 'suspended') {
        initAudioContext();
        if (analyser && !vizBars.length) createVisualizerBars();
        startVisualizer();
      }
    } else {
      stopVisualizer();
    }
  }

  // ========== 专辑封面 ==========
  function setAlbumArt(track) {
    const img = artDisc.querySelector('img');
    const ph  = artDisc.querySelector('.placeholder-art');
    if (img) img.remove();
    if (ph) ph.remove();

    if (track && track.coverUrl) {
      const el = document.createElement('img');
      el.src = track.coverUrl;
      el.onerror = () => {
        el.remove();
        const fallback = document.createElement('div');
        fallback.className = 'placeholder-art';
        fallback.textContent = '\uD83C\uDFB5';
        artDisc.appendChild(fallback);
      };
      artDisc.appendChild(el);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'placeholder-art';
      fallback.textContent = '\uD83C\uDFB5';
      artDisc.appendChild(fallback);
    }
  }

  // ========== UI 同步 ==========
  function updateUIForTrack(index) {
    const track = playlist[index];
    if (!track) return;
    trackTitle.textContent  = track.title;
    trackArtist.textContent = track.artist;
    setAlbumArt(track);
    durationEl.textContent = track.duration || '00:00';

    document.querySelectorAll('.playlist-item').forEach((item, i) => {
      item.classList.toggle('active', i === index);
    });
    document.title = track.title + ' — ' + track.artist + ' | Aurhythm';
  }

  function handleTrackError(name) {
    showToast('\u65E0\u6CD5\u52A0\u8F7D "' + name + '"', '\u8BF7\u5C1D\u8BD5\u4E0A\u4F20\u672C\u5730\u97F3\u4E50\u6587\u4EF6');
  }

  // ========== 曲目加载 ==========
  function loadTrack(index) {
    if (index < 0 || index >= playlist.length) return;
    currentIndex = index;
    const track = playlist[index];
    updateUIForTrack(index);

    if (track.src) {
      audio.src = track.src;
      audio.load();
      audio.play().then(
        () => setPlayingState(true),
        () => { handleTrackError(track.title); setPlayingState(false); }
      );
    } else {
      audio.removeAttribute('src');
      audio.load();
      setPlayingState(false);
      if (currentIndex >= 0) showToast('\u6F14\u793A\u66F2\u76EE — \u4E0A\u4F20\u97F3\u4E50\u6587\u4EF6\u5F00\u59CB\u64AD\u653E');
    }
  }

  function playNext() {
    if (!playlist.length) return;
    let next;
    if (isShuffle && shuffleOrder.length) {
      const pos = shuffleOrder.indexOf(currentIndex);
      next = pos < shuffleOrder.length - 1 ? shuffleOrder[pos + 1] : (shuffleOrder = generateShuffleOrder())[0];
    } else {
      next = (currentIndex + 1) % playlist.length;
    }
    loadTrack(next);
  }

  function playPrev() {
    if (!playlist.length) return;
    if (audio.currentTime > 3) { audio.currentTime = 0; return; }
    let prev;
    if (isShuffle && shuffleOrder.length) {
      const pos = shuffleOrder.indexOf(currentIndex);
      prev = pos > 0 ? shuffleOrder[pos - 1] : shuffleOrder[shuffleOrder.length - 1];
    } else {
      prev = currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1;
    }
    loadTrack(prev);
  }

  // ========== 播放/暂停 ==========
  function togglePlay() {
    if (!audio.src || audio.src === window.location.href) {
      if (!playlist.length) return;
      if (currentIndex < 0) {
        loadTrack(0);
      } else if (playlist[currentIndex]?.src) {
        loadTrack(currentIndex);
      } else {
        showToast('\u8BF7\u4E0A\u4F20\u97F3\u4E50\u6587\u4EF6\u6216\u9009\u62E9\u6709\u6548\u66F2\u76EE');
      }
      return;
    }
    if (audio.paused) {
      if (audioCtx?.state === 'suspended') audioCtx.resume();
      audio.play().then(() => setPlayingState(true), () => setPlayingState(false));
    } else {
      audio.pause();
      setPlayingState(false);
    }
  }

  // ========== 音量控制 ==========
  function setVolume(pct) {
    audio.volume = Math.max(0, Math.min(1, pct));
    volumeFill.style.width = (audio.volume * 100) + '%';
    updateVolumeIcon();
  }

  function updateVolumeIcon() {
    const svg = volumeIcon.querySelector('svg');
    const v = audio.volume;
    if (v === 0) {
      svg.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>';
    } else if (v < 0.5) {
      svg.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/>';
    } else {
      svg.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07"/>';
    }
  }

  // ========== 播放列表渲染 ==========
  function renderPlaylist(filterText) {
    if (filterText === undefined) filterText = '';
    const lower = filterText.toLowerCase();
    const filtered = playlist.filter(
      (t) => t.title.toLowerCase().includes(lower) || t.artist.toLowerCase().includes(lower)
    );

    playlistList.innerHTML = '';
    if (!filtered.length) {
      playlistList.innerHTML = '<div class="no-results">' + (filterText ? '\u672A\u627E\u5230\u5339\u914D\u6B4C\u66F2' : '\u64AD\u653E\u5217\u8868\u4E3A\u7A7A') + '</div>';
      return;
    }

    filtered.forEach((track) => {
      const realIdx = playlist.indexOf(track);
      const item = document.createElement('div');
      item.className = 'playlist-item' + (realIdx === currentIndex ? ' active' : '');

      const color = track.color || '#1a1a3e';
      item.innerHTML =
        '<div class="pl-thumb">' +
          (track.coverUrl
            ? '<img src="' + track.coverUrl + '" alt="" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
              '<div class="pl-placeholder" style="display:none;background:' + color + '">\uD83C\uDFB5</div>'
            : '<div class="pl-placeholder" style="background:' + color + '">\uD83C\uDFB5</div>') +
        '</div>' +
        '<div class="pl-info">' +
          '<div class="pl-title">' + track.title + '</div>' +
          '<div class="pl-artist">' + track.artist + '</div>' +
        '</div>' +
        '<span class="pl-duration">' + (track.duration || '--:--') + '</span>';

      item.addEventListener('click', function () {
        if (realIdx === currentIndex && audio.src) togglePlay();
        else loadTrack(realIdx);
      });
      playlistList.appendChild(item);
    });
  }

  // ========== 文件上传 ==========
  function addFilesToPlaylist(files) {
    Array.from(files).forEach(function (file) {
      if (!file.type.startsWith('audio/')) return;
      playlist.push({
        id: 'local_' + Date.now() + Math.random(),
        title: file.name.replace(/\.[^/.]+$/, ''),
        artist: '\u672C\u5730\u97F3\u4E50',
        duration: '--:--',
        src: URL.createObjectURL(file),
        color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
        isLocal: true,
        fileName: file.name,
      });
    });
    renderPlaylist(searchInput.value);
    if (currentIndex < 0) loadTrack(0);
    showToast('\u5DF2\u6DFB\u52A0 ' + files.length + ' \u9996\u6B4C\u66F2');
  }

  // ========== 事件绑定 ==========

  // 播放按钮
  btnPlay.addEventListener('click', togglePlay);

  // 音频事件
  audio.addEventListener('play',  function () { setPlayingState(true); });
  audio.addEventListener('pause', function () { setPlayingState(false); });
  audio.addEventListener('ended', function () {
    if (repeatMode === 2)           { audio.currentTime = 0; audio.play(); }
    else if (repeatMode === 1 || isShuffle) playNext();
    else if (currentIndex < playlist.length - 1) playNext();
    else setPlayingState(false);
  });
  audio.addEventListener('loadedmetadata', function () {
    durationEl.textContent = formatTime(audio.duration);
    var track = playlist[currentIndex];
    if (track && !track._origDuration) {
      track._origDuration = track.duration;
      track.duration = formatTime(audio.duration);
      durationEl.textContent = track.duration;
      renderPlaylist(searchInput.value);
    }
  });
  audio.addEventListener('timeupdate', function () {
    var pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    progressFill.style.width = pct + '%';
    currentTimeEl.textContent = formatTime(audio.currentTime);
  });
  audio.addEventListener('error', function () {
    handleTrackError((playlist[currentIndex] || {}).title || '\u672A\u77E5\u66F2\u76EE');
    setPlayingState(false);
  });

  // 进度条
  var dragging = false;
  progressBar.addEventListener('click', function (e) {
    if (!audio.duration) return;
    audio.currentTime = ((e.clientX - progressBar.getBoundingClientRect().left) / progressBar.offsetWidth) * audio.duration;
  });
  progressBar.addEventListener('mousedown', function (e) {
    dragging = true;
    if (audio.duration) audio.currentTime = ((e.clientX - progressBar.getBoundingClientRect().left) / progressBar.offsetWidth) * audio.duration;
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging || !audio.duration) return;
    var pct = Math.max(0, Math.min(1, (e.clientX - progressBar.getBoundingClientRect().left) / progressBar.offsetWidth));
    audio.currentTime = pct * audio.duration;
  });
  document.addEventListener('mouseup', function () { dragging = false; });

  // 音量
  var draggingVol = false;
  volumeSlider.addEventListener('click', function (e) {
    setVolume((e.clientX - volumeSlider.getBoundingClientRect().left) / volumeSlider.offsetWidth);
  });
  volumeSlider.addEventListener('mousedown', function (e) {
    draggingVol = true;
    setVolume((e.clientX - volumeSlider.getBoundingClientRect().left) / volumeSlider.offsetWidth);
  });
  document.addEventListener('mousemove', function (e) {
    if (!draggingVol) return;
    setVolume((e.clientX - volumeSlider.getBoundingClientRect().left) / volumeSlider.offsetWidth);
  });
  document.addEventListener('mouseup', function () { draggingVol = false; });

  volumeIcon.addEventListener('click', function () {
    if (audio.volume > 0) { audio._lastVol = audio.volume; setVolume(0); }
    else setVolume(audio._lastVol || 0.7);
  });

  // 上一首/下一首
  btnNext.addEventListener('click', playNext);
  btnPrev.addEventListener('click', playPrev);

  // 随机播放
  btnShuffle.addEventListener('click', function () {
    isShuffle = !isShuffle;
    btnShuffle.classList.toggle('active', isShuffle);
    if (isShuffle) { shuffleOrder = generateShuffleOrder(); showToast('\u968F\u673A\u64AD\u653E\u5DF2\u5F00\u542F'); }
    else showToast('\u987A\u5E8F\u64AD\u653E');
  });

  // 循环模式
  btnRepeat.addEventListener('click', function () {
    repeatMode = (repeatMode + 1) % 3;
    btnRepeat.classList.remove('active', 'repeat-one');
    if (repeatMode === 1)      { btnRepeat.classList.add('active');        showToast('\u5217\u8868\u5FAA\u73AF'); }
    else if (repeatMode === 2) { btnRepeat.classList.add('active', 'repeat-one'); showToast('\u5355\u66F2\u5FAA\u73AF'); }
    else showToast('\u5FAA\u73AF\u5173\u95ED');
  });

  // 搜索
  searchInput.addEventListener('input', function () { renderPlaylist(searchInput.value); });

  // 文件上传
  fileUpload.addEventListener('change', function (e) {
    if (e.target.files.length) { addFilesToPlaylist(e.target.files); fileUpload.value = ''; }
  });

  // 拖拽上传
  function dragOver(e)  { e.preventDefault(); e.stopPropagation(); playerMain.style.borderColor = 'var(--accent)'; }
  function dragLeave(e) { e.preventDefault(); e.stopPropagation(); playerMain.style.borderColor = ''; }
  function dragDrop(e)  {
    e.preventDefault(); e.stopPropagation();
    playerMain.style.borderColor = '';
    if (e.dataTransfer.files.length) addFilesToPlaylist(e.dataTransfer.files);
  }
  playerMain.addEventListener('dragover', dragOver);
  playerMain.addEventListener('dragleave', dragLeave);
  playerMain.addEventListener('drop', dragDrop);

  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    var ua = document.querySelector('.upload-area');
    if (ua) ua.style.borderColor = 'var(--accent)';
  });
  document.addEventListener('dragleave', function () {
    var ua = document.querySelector('.upload-area');
    if (ua) ua.style.borderColor = '';
  });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    var ua = document.querySelector('.upload-area');
    if (ua) ua.style.borderColor = '';
    if (e.dataTransfer.files.length) addFilesToPlaylist(e.dataTransfer.files);
  });

  // ========== 键盘快捷键 ==========
  document.addEventListener('keydown', function (e) {
    if (document.activeElement === searchInput) return;
    switch (e.code) {
      case 'Space':        e.preventDefault(); togglePlay(); break;
      case 'ArrowLeft':    e.preventDefault(); e.metaKey || e.ctrlKey ? playPrev() : (audio.currentTime = Math.max(0, audio.currentTime - 5)); break;
      case 'ArrowRight':   e.preventDefault(); e.metaKey || e.ctrlKey ? playNext() : (audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5)); break;
      case 'ArrowUp':      e.preventDefault(); setVolume(audio.volume + 0.05); break;
      case 'ArrowDown':    e.preventDefault(); setVolume(audio.volume - 0.05); break;
      case 'KeyS':         if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); btnShuffle.click(); } break;
      case 'KeyR':         if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); btnRepeat.click(); } break;
    }
  });

  // ========== 初始化 ==========
  audio.volume = 0.7;
  setVolume(0.7);

  // 从 Supabase 加载歌曲列表，成功后渲染播放列表
  (async function initPlaylist() {
    playlist = await fetchSongs();
    renderPlaylist();
  })();

  document.addEventListener('click', function once() {
    if (!audioCtx) initAudioContext();
    if (audioCtx?.state === 'suspended') audioCtx.resume();
  }, { once: true });

  document.addEventListener('touchstart', function once() {
    if (!audioCtx) initAudioContext();
    if (audioCtx?.state === 'suspended') audioCtx.resume();
  }, { once: true });

})();
