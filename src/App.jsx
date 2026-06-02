import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { supabase } from './supabaseClient';
import SongList from './components/SongList';

const AuthModal = lazy(() => import('./components/AuthModal'));
const CreatePlaylistModal = lazy(() => import('./components/CreatePlaylistModal'));

// ========== 工具函数 ==========
function formatTime(sec) {
  if (isNaN(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function App() {
  // ========== 状态 ==========
  const [songs, setSongs] = useState([]);           // 所有公共音乐
  const [userSongs, setUserSongs] = useState([]);   // 用户自己上传的音乐
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState('00:00');
  const [duration, setDuration] = useState('00:00');
  const [volume, setVolume] = useState(0.7);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState(0); // 0=off, 1=all, 2=one
  const [searchText, setSearchText] = useState('');
  const [toast, setToast] = useState('');

  // ========== Auth 状态 ==========
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  
  // ========== 面板状态 ==========
  const [showMessagePanel, setShowMessagePanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [showCreatePlaylistModal, setShowCreatePlaylistModal] = useState(false);
  
  // ========== 歌单数据 ==========
  const [playlists, setPlaylists] = useState([]);
  
  // ========== 主题状态 ==========
  const [theme, setTheme] = useState('dark'); // dark, light, ocean
  
  // ========== 视图状态 ==========
  const [currentView, setCurrentView] = useState('discover'); // discover, playlist, playlist-detail
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);

  // ========== 添加到歌单状态 ==========
  const [addToPlaylistTarget, setAddToPlaylistTarget] = useState(null); // { songId, x, y }

  const audioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const vizBarsRef = useRef([]);
  const vizAnimRef = useRef(null);
  const vizElRef = useRef(null);
  const shuffleOrderRef = useRef([]);
  const toastTimerRef = useRef(null);
  const lastVolRef = useRef(0.7);
  const userMenuRef = useRef(null);
  const recommendingRef = useRef(new Set());   // 防重复推荐
  const playsUpdatingRef = useRef(new Set());  // 防重复播放计数

  const playlist = songs; // songs 即为播放列表

  // 当前曲目
  const currentTrack = playlist[currentIndex] || null;

  // ========== Toast ==========
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 2500);
  }, []);

  // ========== 从 Supabase 加载歌曲和歌单 ==========
  useEffect(() => {
    async function fetchData() {
      // Supabase 未配置时显示空内容
      if (!supabase) {
        console.warn('Supabase 未配置，请在 .env.local 中设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY');
        setSongs([]);
        setUserSongs([]);
        setPlaylists([]);
        setLoading(false);
        return;
      }

      try {
        // 加载所有公共音乐（8秒超时兜底，防止网络卡住导致 loading 永远不灭）
        const songsPromise = supabase.from('songs').select('*');
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('请求超时，请检查网络')), 8000)
        );
        const { data: allSongs, error: songsError } = await Promise.race([songsPromise, timeoutPromise]);

        if (songsError) {
          console.error('Supabase 查询歌曲失败:', songsError);
          setError(songsError.message);
          setSongs([]);
          showToast('加载歌曲失败');
        } else if (!allSongs || allSongs.length === 0) {
          console.warn('Supabase 返回空歌曲数据');
          setSongs([]);
        } else {
          const formattedSongs = allSongs.map(song => ({
            id:         song.song_id,
            title:      song.title    || '未知曲目',
            artist:     song.artist   || '未知艺术家',
            duration:   song.duration || '--:--',
            color:      song.color    || '#1a1a3e',
            coverUrl:   song.cover_url || null,
            src:        song.song_url || null,
            userId:     song.user_id  || null,
            playlistId: song.playlist_id || null,
            // 统计数据（直接使用数据库字段，NULL 时默认为 0）
            plays:      song.plays      ?? 0,
            recommends: song.recommends ?? 0,
            likes:      song.likes      ?? 0,
            comments:   song.comments   ?? 0,
          }));
          setSongs(formattedSongs);

          // 如果用户已登录，筛选出用户自己上传的歌曲
          if (user) {
            const userUploaded = formattedSongs.filter(s => s.userId === user.id);
            setUserSongs(userUploaded);
          }
        }

        // 如果用户已登录，加载用户的歌单
        if (user) {
          const { data: userPlaylists, error: playlistsError } = await supabase
            .from('playlists')
            .select('*')
            .eq('user_id', user.id);

          if (playlistsError) {
            console.error('Supabase 查询歌单失败:', playlistsError);
            setPlaylists([]);
          } else {
            setPlaylists(userPlaylists || []);
          }
        } else {
          setPlaylists([]);
        }
      } catch (err) {
        console.error('加载数据异常:', err);
        setError(err.message || '加载失败');
        showToast(err.message || '加载失败');
        setSongs([]);
        setUserSongs([]);
        setPlaylists([]);
      }

      setLoading(false);
    }
    fetchData();
  }, [user]); // 用户变化时重新加载

  // ========== 创建歌单 ==========
  const handleCreatePlaylist = useCallback(async (name, description) => {
    if (!supabase || !user) return;

    const { error } = await supabase.from('playlists').insert({
      name: name || '未命名歌单',
      description: description || '',
      user_id: user.id,
      created_at: new Date().toISOString(),
    });

    if (error) {
      showToast('创建歌单失败: ' + error.message);
      return false;
    } else {
      showToast('歌单创建成功！');
      // 重新加载歌单列表
      const { data: userPlaylists } = await supabase
        .from('playlists')
        .select('*')
        .eq('user_id', user.id);
      setPlaylists(userPlaylists || []);
      return true;
    }
  }, [user, showToast]);

  // ========== Auth: 初始化 session + 监听登录状态变化 ==========
  useEffect(() => {
    if (!supabase) return;

    // 获取当前 session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    }).catch((err) => {
      console.warn('getSession 失败:', err.message);
      // 如果刷新令牌无效，直接清除 localStorage 中的认证数据
      if (err.message?.includes('Refresh Token') || err.message?.includes('Invalid')) {
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('sb-')) localStorage.removeItem(key);
        });
        console.log('已清除无效的本地认证数据');
      }
      setUser(null);
    });

    // 监听 auth 状态变化（登录/登出/邮箱验证/Token 刷新等）
    try {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        setUser(session?.user ?? null);

        // 根据事件类型给出提示（延迟显示，避免覆盖初始加载时的 toast）
        switch (event) {
          case 'SIGNED_IN':
            if (session?.user?.email_confirmed_at) {
              // 邮箱验证成功后自动登录，延迟显示 toast
              setTimeout(() => showToast('登录成功'), 500);
            } else {
              // 邮箱未验证，不允许登录，立即登出
              setUser(null);
              supabase.auth.signOut();
              showToast('请先验证邮箱后再登录');
            }
            break;
          case 'SIGNED_OUT':
            setUser(null);
            break;
          case 'USER_UPDATED':
            showToast('用户信息已更新');
            break;
          case 'PASSWORD_RECOVERY':
            showToast('请检查邮箱重置密码');
            break;
        }
      });
      return () => subscription.unsubscribe();
    } catch (err) {
      console.warn('onAuthStateChange 失败:', err.message);
      return () => {};
    }
  }, []);

  // ========== 点击外部关闭用户菜单 ==========
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ========== 登出 ==========
  const handleLogout = useCallback(async () => {
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) showToast('登出失败: ' + error.message);
      else showToast('已登出');
    } catch (err) {
      showToast('登出失败: ' + err.message);
    }
  }, [showToast]);

  // ========== 推荐歌曲 ==========
  const handleRecommendSong = useCallback(async (songId) => {
    if (!supabase || !user) {
      showToast('请先登录');
      return;
    }

    // 防止快速连点造成重复请求
    if (recommendingRef.current.has(songId)) return;

    const song = songs.find(s => s.id === songId);
    if (!song) return;

    // 本地歌曲不支持推荐
    if (song.isLocal) {
      showToast('本地歌曲暂不支持推荐');
      return;
    }

    recommendingRef.current.add(songId);
    const oldRecommends = song.recommends || 0;
    const newRecommends = oldRecommends + 1;

    // 乐观更新 UI（立即响应用户操作）
    setSongs(prev => prev.map(s =>
      s.id === songId ? { ...s, recommends: newRecommends } : s
    ));

    const { error } = await supabase.from('songs')
      .update({ recommends: newRecommends })
      .eq('song_id', songId);

    recommendingRef.current.delete(songId);

    if (error) {
      // 失败则回滚到旧值
      setSongs(prev => prev.map(s =>
        s.id === songId ? { ...s, recommends: oldRecommends } : s
      ));
      showToast('操作失败: ' + error.message);
    } else {
      showToast('已推荐 ⭐');
    }
  }, [user, songs, showToast]);

  // ========== 添加歌曲到歌单 ==========
  const handleAddToPlaylist = useCallback(async (songId, playlistId) => {
    if (!supabase || !user) {
      showToast('请先登录');
      return;
    }
    const song = songs.find(s => s.id === songId);
    if (!song) return;
    if (!song.userId || song.userId !== user.id) {
      showToast('只能将自己的歌曲添加到歌单');
      return;
    }

    const { error } = await supabase.from('songs')
      .update({ playlist_id: playlistId })
      .eq('song_id', songId);

    if (error) {
      showToast('操作失败: ' + error.message);
    } else {
      const targetPlaylist = playlists.find(p => p.id === playlistId);
      setSongs(prev => prev.map(s =>
        s.id === songId ? { ...s, playlistId } : s
      ));
      setUserSongs(prev => prev.map(s =>
        s.id === songId ? { ...s, playlistId } : s
      ));
      showToast(`已添加到「${targetPlaylist?.name || '歌单'}」`);
    }
    setAddToPlaylistTarget(null);
  }, [user, songs, playlists, showToast]);

  // ========== 发布歌曲到 Supabase（需登录） ==========
  const handlePublishSong = useCallback(async (files) => {
    if (!supabase) {
      showToast('Supabase 未配置');
      return;
    }

    // 未登录时弹出登录框
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/'));
    if (!audioFiles.length) return;

    for (const file of audioFiles) {
      const fileExt = file.name.split('.').pop();
      const filePath = `songs/${user.id}/${Date.now()}.${fileExt}`;

      showToast('正在上传 "' + file.name + '"…');

      // 1. 上传音频文件到 Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('songs')
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (uploadError) {
        showToast('上传失败: ' + uploadError.message);
        continue;
      }

      // 2. 获取公开 URL
      const { data: urlData } = supabase.storage.from('songs').getPublicUrl(filePath);
      const publicUrl = urlData?.publicUrl || null;

      // 3. 插入 songs 表
      const title = file.name.replace(/\.[^/.]+$/, '');
      const { data: insertedSongs, error: insertError } = await supabase.from('songs').insert({
        title: title,
        artist: user.email || '未知艺术家',
        duration: '--:--',
        color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
        song_url: publicUrl,
        user_id: user.id,
        created_at: new Date().toISOString(),
        plays: 0,
        recommends: 0,
        likes: 0,
        comments: 0,
      }).select();

      if (insertError) {
        showToast('发布失败: ' + insertError.message);
      } else {
        showToast('"' + title + '" 发布成功！');
        // 用数据库返回的数据更新状态
        if (insertedSongs && insertedSongs.length > 0) {
          const dbSong = insertedSongs[0];
          const newSong = {
            id:         dbSong.song_id,
            title:      dbSong.title,
            artist:     dbSong.artist,
            duration:   dbSong.duration || '--:--',
            color:      dbSong.color || '#1a1a3e',
            coverUrl:   dbSong.cover_url || null,
            src:        dbSong.song_url,
            userId:     dbSong.user_id,
            playlistId: dbSong.playlist_id || null,
            plays:      dbSong.plays || 0,
            recommends: dbSong.recommends || 0,
            likes:      dbSong.likes || 0,
            comments:   dbSong.comments || 0,
          };
          setSongs(prev => [...prev, newSong]);
          setUserSongs(prev => [...prev, newSong]);
        }
      }
    }
  }, [user, showToast]);

  // ========== AudioContext & 可视化 ==========
  const initAudioContext = useCallback(() => {
    if (audioCtxRef.current) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    const source = ctx.createMediaElementSource(audioRef.current);
    source.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    sourceRef.current = source;
  }, []);

  const createVisualizerBars = useCallback(() => {
    const el = vizElRef.current;
    if (!el || !analyserRef.current) return;
    el.innerHTML = '';
    vizBarsRef.current = [];
    const count = Math.min(64, analyserRef.current.frequencyBinCount);
    for (let i = 0; i < count; i++) {
      const bar = document.createElement('div');
      bar.className = 'visualizer-bar';
      el.appendChild(bar);
      vizBarsRef.current.push(bar);
    }
  }, []);

  const updateVisualizer = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(data);
    const bars = vizBarsRef.current;
    const step = Math.floor(data.length / bars.length);
    for (let i = 0; i < bars.length; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
      bars[i].style.height = Math.max(3, (sum / step / 255) * 60) + 'px';
    }
    vizAnimRef.current = requestAnimationFrame(updateVisualizer);
  }, []);

  const startVisualizer = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (analyserRef.current && !vizBarsRef.current.length) createVisualizerBars();
    if (!vizAnimRef.current) updateVisualizer();
  }, [createVisualizerBars, updateVisualizer]);

  const stopVisualizer = useCallback(() => {
    if (vizAnimRef.current) { cancelAnimationFrame(vizAnimRef.current); vizAnimRef.current = null; }
    vizBarsRef.current.forEach(b => (b.style.height = '3px'));
  }, []);

  // ========== 曲目加载 ==========
  const loadTrack = useCallback((index) => {
    if (index < 0 || index >= playlist.length) return;
    const track = playlist[index];
    setCurrentIndex(index);

    if (track.src) {
      audioRef.current.src = track.src;
      audioRef.current.load();
      audioRef.current.play().then(
        () => {
          setIsPlaying(true);
          // 更新播放次数（乐观更新 + 防同一首歌重复计数）
          if (track.id && !track.isLocal && !playsUpdatingRef.current.has(track.id)) {
            playsUpdatingRef.current.add(track.id);
            const oldPlays = track.plays || 0;
            const newPlays = oldPlays + 1;

            setSongs(prev => prev.map(s =>
              s.id === track.id ? { ...s, plays: newPlays } : s
            ));

            supabase.from('songs')
              .update({ plays: newPlays })
              .eq('song_id', track.id)
              .then(({ error }) => {
                playsUpdatingRef.current.delete(track.id);
                if (error) {
                  // 失败则回滚
                  setSongs(prev => prev.map(s =>
                    s.id === track.id ? { ...s, plays: oldPlays } : s
                  ));
                }
              });
          }
        },
        () => { showToast('无法加载 "' + track.title + '"'); setIsPlaying(false); }
      );
    } else {
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      setIsPlaying(false);
      showToast('演示曲目 — 上传音乐文件开始播放');
    }
  }, [playlist, showToast]);

  // ========== 播放/暂停 ==========
  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio.src || audio.src === window.location.href) {
      if (!playlist.length) return;
      if (currentIndex < 0) loadTrack(0);
      else if (playlist[currentIndex]?.src) loadTrack(currentIndex);
      else showToast('请上传音乐文件或选择有效曲目');
      return;
    }
    if (audio.paused) {
      if (audioCtxRef.current?.state === 'suspended') audioCtxRef.current.resume();
      audio.play().then(() => setIsPlaying(true), () => setIsPlaying(false));
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [playlist, currentIndex, loadTrack, showToast]);

  // ========== 上一首/下一首 ==========
  const generateShuffleOrder = useCallback(() => {
    const arr = Array.from({ length: playlist.length }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    if (arr[0] === currentIndex && arr.length > 1) {
      [arr[0], arr[1]] = [arr[1], arr[0]];
    }
    return arr;
  }, [playlist.length, currentIndex]);

  const playNext = useCallback(() => {
    if (!playlist.length) return;
    let next;
    if (isShuffle && shuffleOrderRef.current.length) {
      const pos = shuffleOrderRef.current.indexOf(currentIndex);
      next = pos < shuffleOrderRef.current.length - 1
        ? shuffleOrderRef.current[pos + 1]
        : (shuffleOrderRef.current = generateShuffleOrder())[0];
    } else {
      next = (currentIndex + 1) % playlist.length;
    }
    loadTrack(next);
  }, [playlist, currentIndex, isShuffle, generateShuffleOrder, loadTrack]);

  const playPrev = useCallback(() => {
    if (!playlist.length) return;
    if (audioRef.current.currentTime > 3) { audioRef.current.currentTime = 0; return; }
    let prev;
    if (isShuffle && shuffleOrderRef.current.length) {
      const pos = shuffleOrderRef.current.indexOf(currentIndex);
      prev = pos > 0 ? shuffleOrderRef.current[pos - 1] : shuffleOrderRef.current[shuffleOrderRef.current.length - 1];
    } else {
      prev = currentIndex <= 0 ? playlist.length - 1 : currentIndex - 1;
    }
    loadTrack(prev);
  }, [playlist, currentIndex, isShuffle, loadTrack]);

  // ========== 音频事件 ==========
  useEffect(() => {
    const audio = audioRef.current;

    const onPlay = () => {
      setIsPlaying(true);
      if (!audioCtxRef.current) { initAudioContext(); createVisualizerBars(); }
      startVisualizer();
    };
    const onPause = () => { setIsPlaying(false); stopVisualizer(); };
    const onEnded = () => {
      if (repeatMode === 2) { audio.currentTime = 0; audio.play(); }
      else if (repeatMode === 1 || isShuffle) playNext();
      else if (currentIndex < playlist.length - 1) playNext();
      else setIsPlaying(false);
    };
    const onLoadedMetadata = () => {
      const dur = formatTime(audio.duration);
      setDuration(dur);
    };
    const onTimeUpdate = () => {
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      setProgress(pct);
      setCurrentTime(formatTime(audio.currentTime));
    };
    const onError = () => {
      showToast('无法加载曲目');
      setIsPlaying(false);
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('error', onError);
    };
  }, [repeatMode, isShuffle, currentIndex, playlist.length, playNext, showToast, initAudioContext, createVisualizerBars, startVisualizer, stopVisualizer]);

  // ========== 键盘快捷键 ==========
  useEffect(() => {
    function onKey(e) {
      if (document.activeElement.tagName === 'INPUT') return;
      switch (e.code) {
        case 'Space':      e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft':   e.preventDefault(); e.metaKey || e.ctrlKey ? playPrev() : (audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5)); break;
        case 'ArrowRight':  e.preventDefault(); e.metaKey || e.ctrlKey ? playNext() : (audioRef.current.currentTime = Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + 5)); break;
        case 'ArrowUp':     e.preventDefault(); setVolume(v => Math.min(1, v + 0.05)); break;
        case 'ArrowDown':   e.preventDefault(); setVolume(v => Math.max(0, v - 0.05)); break;
        case 'KeyS':        if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); setIsShuffle(s => !s); } break;
        case 'KeyR':        if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); setRepeatMode(m => (m + 1) % 3); } break;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [togglePlay, playPrev, playNext]);

  // 同步音量到 audio 元素
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // ========== 主题切换 ==========
  const themeMountedRef = useRef(false);
  useEffect(() => {
    const themeColors = {
      dark: {
        '--bg-deep': '#06060e',
        '--bg-sidebar': '#121212',
        '--bg-player': '#181818',
        '--accent': '#d4a574',
        '--accent2': '#7b6fdf',
      },
      light: {
        '--bg-deep': '#f8f9fa',
        '--bg-sidebar': '#ffffff',
        '--bg-player': '#f1f3f4',
        '--accent': '#c97d4c',
        '--accent2': '#6b5fd0',
      },
      ocean: {
        '--bg-deep': '#0a192f',
        '--bg-sidebar': '#112240',
        '--bg-player': '#112240',
        '--accent': '#64ffda',
        '--accent2': '#9333ea',
      },
    };
    const root = document.documentElement;
    Object.entries(themeColors[theme]).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
    // 首次渲染不弹 toast
    if (themeMountedRef.current) {
      showToast(`已切换到${theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '海洋'}主题`);
    } else {
      themeMountedRef.current = true;
    }
  }, [theme, showToast]);

  // ========== 文件上传 ==========
  const handleFileUpload = useCallback((files) => {
    const newSongs = Array.from(files)
      .filter(f => f.type.startsWith('audio/'))
      .map(file => ({
        id: 'local_' + Date.now() + Math.random(),
        title: file.name.replace(/\.[^/.]+$/, ''),
        artist: '本地音乐',
        duration: '--:--',
        src: URL.createObjectURL(file),
        color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
        isLocal: true,
        plays: 0,
        recommends: 0,
        likes: 0,
        comments: 0,
      }));
    if (newSongs.length) {
      setSongs(prev => [...prev, ...newSongs]);
      showToast('已添加 ' + newSongs.length + ' 首歌曲');
      if (currentIndex < 0) loadTrack(0);
    }
  }, [currentIndex, loadTrack, showToast]);

  // ========== 进度条拖拽 ==========
  const handleProgressClick = useCallback((e) => {
    const bar = e.currentTarget;
    const audio = audioRef.current;
    if (!audio.duration) return;
    const pct = (e.clientX - bar.getBoundingClientRect().left) / bar.offsetWidth;
    audio.currentTime = pct * audio.duration;
  }, []);

  // ========== 音量条 ==========
  const handleVolumeClick = useCallback((e) => {
    const bar = e.currentTarget;
    const pct = Math.max(0, Math.min(1, (e.clientX - bar.getBoundingClientRect().left) / bar.offsetWidth));
    setVolume(pct);
  }, []);

  // ========== 渲染 ==========
  return (
    <>
      {/* 氛围背景 */}
      <div className="bg-ambient">
        <div className="orb"></div>
        <div className="orb"></div>
        <div className="orb"></div>
      </div>

      {/* Toast */}
      {toast && <div className="toast show">{toast}</div>}

      {/* 登录/注册弹窗 */}
      {showAuthModal && (
        <Suspense fallback={null}>
          <AuthModal
            onClose={() => setShowAuthModal(false)}
            onAuthSuccess={(u) => { setUser(u); setShowAuthModal(false); showToast('登录成功'); }}
          />
        </Suspense>
      )}

      {/* 创建歌单弹窗 */}
      {showCreatePlaylistModal && (
        <Suspense fallback={null}>
          <CreatePlaylistModal
            onClose={() => setShowCreatePlaylistModal(false)}
            onCreate={(name, desc) => {
              handleCreatePlaylist(name, desc).then(success => {
                if (success) {
                  setShowCreatePlaylistModal(false);
                }
              });
            }}
          />
        </Suspense>
      )}

      {/* 全局布局：Sidebar + Main + Bottom Player */}
      <div className="app-layout">

        {/* 左侧 Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-brand">
            <span className="brand-icon">🎵</span>
            <span className="brand-name">Aurhythm</span>
          </div>

          <nav className="sidebar-nav">
            <div className="nav-section">
              <button 
                className={`nav-item${currentView === 'discover' ? ' active' : ''}`}
                onClick={() => setCurrentView('discover')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                <span>发现音乐</span>
              </button>
              <button 
                className={`nav-item${currentView === 'playlist' ? ' active' : ''}`}
                onClick={() => setCurrentView('playlist')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><polygon points="10 8 16 12 10 16 10 8"/>
                </svg>
                <span>我的歌单</span>
              </button>
            </div>
          </nav>


        </aside>

        {/* 主内容区 */}
        <div className="main-content">
          {/* Header */}
          <header className="main-header">
            <button className="header-btn header-back" onClick={() => {
                    if (currentView === 'playlist-detail') {
                      setCurrentView('playlist');
                    } else if (currentView === 'playlist') {
                      setCurrentView('discover');
                    } else {
                      showToast('已经是首页');
                    }
                  }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/>
              </svg>
            </button>
            <div className="header-search">
              <span className="header-search-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </span>
              <input
                type="text"
                placeholder="搜索歌曲..."
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
              />
            </div>
            <button className="header-btn header-message" onClick={() => setShowMessagePanel(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              <span className="badge">3</span>
            </button>
            <button className="header-btn header-settings" onClick={() => setShowSettingsPanel(true)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            {user ? (
              <div className="header-user-menu" ref={userMenuRef}>
                <button className="header-user-btn" onClick={() => setShowUserMenu(!showUserMenu)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                  <span className="header-user-name">{user.email?.split('@')[0] || '用户'}</span>
                </button>
                {showUserMenu && (
                  <div className="user-dropdown">
                    <div className="dropdown-group">
                      <button className="dropdown-item" onClick={() => { setShowUserMenu(false); setShowProfilePanel(true); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                          <circle cx="12" cy="7" r="4"/>
                        </svg>
                        <span>个人信息设置</span>
                      </button>
                    </div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-group">
                      <button className="dropdown-item" onClick={() => { setShowUserMenu(false); showToast('绑定社交账号功能开发中'); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
                        </svg>
                        <span>绑定社交账号</span>
                      </button>
                      <button className="dropdown-item" onClick={() => { setShowUserMenu(false); showToast('当前已是最新版本'); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10"/><polyline points="18 21 18 15 24 15"/><path d="M20 10h-9v9"/><path d="M14 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>
                        </svg>
                        <span>检查更新</span>
                      </button>
                      <button className="dropdown-item" onClick={() => { setShowUserMenu(false); setShowSettingsPanel(true); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                        </svg>
                        <span>主题设置</span>
                      </button>
                    </div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-group">
                      <button className="dropdown-item logout" onClick={() => { setShowUserMenu(false); handleLogout(); }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                          <polyline points="16 17 21 12 16 7"/>
                          <line x1="21" y1="12" x2="9" y2="12"/>
                        </svg>
                        <span>退出登录</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button className="header-login-btn" onClick={() => setShowAuthModal(true)}>登录</button>
            )}
          </header>

          {/* 内容 */}
          <div className="content-body">
            {currentView === 'discover' ? (
              <SongList
                songs={playlist}
                currentIndex={currentIndex}
                loading={loading}
                error={error}
                searchText={searchText}
                onSearchChange={setSearchText}
                onSelectTrack={(idx) => { if (idx === currentIndex && audioRef.current.src) togglePlay(); else loadTrack(idx); }}
                onRecommend={handleRecommendSong}
                onAddToPlaylist={(songId, e) => {
                  if (!user) { showToast('请先登录'); return; }
                  if (playlists.length === 0) { showToast('请先创建歌单'); return; }
                  const rect = e.currentTarget.getBoundingClientRect();
                  setAddToPlaylistTarget({ songId, x: rect.left, y: rect.bottom + 4 });
                }}
                playlists={playlists}
                user={user}
                addToPlaylistTarget={addToPlaylistTarget}
                onSelectPlaylist={(playlistId) => handleAddToPlaylist(addToPlaylistTarget?.songId, playlistId)}
                onClosePlaylistPicker={() => setAddToPlaylistTarget(null)}
              />
            ) : currentView === 'playlist' ? (
              <div className="playlists-view">
                <div className="section-header">
                  <h2>我的歌单</h2>
                  {user && (
                    <button className="btn-primary" onClick={() => setShowCreatePlaylistModal(true)}>创建歌单</button>
                  )}
                </div>
                <div className="playlists-grid">
                  {!user ? (
                    <div className="no-playlists">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><polygon points="10 8 16 12 10 16 10 8"/>
                      </svg>
                      <p>请登录查看我的歌单</p>
                      <p className="hint">登录后可以创建歌单并上传歌曲</p>
                    </div>
                  ) : playlists.length === 0 ? (
                    <div className="no-playlists">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><polygon points="10 8 16 12 10 16 10 8"/>
                      </svg>
                      <p>暂无歌单</p>
                      <p className="hint">点击上方按钮创建新的歌单</p>
                    </div>
                  ) : (
                    playlists.map(playlist => {
                      // 获取该歌单的歌曲
                      const playlistSongs = userSongs.filter(s => s.playlistId === playlist.id);
                      return (
                        <div 
                          key={playlist.id}
                          className="playlist-card" 
                          onClick={() => {
                            setSelectedPlaylist({
                              id: playlist.id,
                              name: playlist.name,
                              cover: '🎵',
                              description: playlist.description,
                              creator: user?.email?.split('@')[0] || '我',
                              createdAt: playlist.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
                              songs: playlistSongs,
                              likes: playlist.likes || 0,
                              plays: playlist.plays || 0
                            });
                            setCurrentView('playlist-detail');
                          }}
                        >
                          <div className="playlist-cover">🎵</div>
                          <div className="playlist-info">
                            <h3>{playlist.name}</h3>
                            <p>{playlistSongs.length} 首歌曲</p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="playlist-detail-view">
                {/* 歌单头部 */}
                <div className="detail-header">
                  <div className="detail-cover">
                    <span className="cover-icon">{selectedPlaylist?.cover || '🎵'}</span>
                  </div>
                  <div className="detail-info">
                    <h1 className="detail-title">{selectedPlaylist?.name || '未知歌单'}</h1>
                    <p className="detail-desc">{selectedPlaylist?.description || ''}</p>
                    <div className="detail-meta">
                      <span className="meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                        {selectedPlaylist?.plays?.toLocaleString() || 0}
                      </span>
                      <span className="meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                        </svg>
                        {selectedPlaylist?.likes || 0}
                      </span>
                      <span className="meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><polygon points="10 8 16 12 10 16 10 8"/>
                        </svg>
                        {selectedPlaylist?.songs?.length || 0} 首歌曲
                      </span>
                    </div>
                    <div className="detail-actions">
                      <button className="btn-play-all" onClick={() => {
                        if (selectedPlaylist?.songs?.length > 0) {
                          setSongs(selectedPlaylist.songs);
                          loadTrack(0);
                        }
                      }}>
                        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        <span>播放全部</span>
                      </button>
                      <button className="btn-secondary">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                        </svg>
                        <span>收藏</span>
                      </button>
                      <button className="btn-secondary">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        <span>分享</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* 歌曲列表 */}
                <div className="detail-tracks">
                  <div className="tracks-header">
                    <span className="tracks-count">{selectedPlaylist?.songs?.length || 0} 首歌曲</span>
                  </div>
                  <div className="tracks-list">
                    {(selectedPlaylist?.songs || []).map((song, idx) => (
                      <div 
                        key={idx}
                        className={`track-item${currentIndex === idx && playlist[currentIndex]?.id === song.id ? ' active' : ''}`}
                        onClick={() => {
                          setSongs(selectedPlaylist.songs);
                          loadTrack(idx);
                        }}
                      >
                        <span className="track-number">{idx + 1}</span>
                        <div className="track-info">
                          <span className="track-title">{song.title}</span>
                          <span className="track-artist">{song.artist}</span>
                        </div>
                        <span className="track-album">未知专辑</span>
                        <button className="track-like">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                          </svg>
                        </button>
                        <span className="track-duration">{song.duration || '--:--'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 可视化条（在底部播放条上方） */}
      <div className="visualizer" ref={vizElRef}></div>

      {/* 底部固定播放条 */}
      <div className="bottom-player">
        {/* 左侧：歌曲信息 */}
        <div className="bp-left">
          <div className={`bp-cover${isPlaying ? ' spinning' : ''}`}>
            {currentTrack?.coverUrl
              ? <img src={currentTrack.coverUrl} alt="" />
              : <div className="bp-cover-placeholder">🎵</div>
            }
          </div>
          <div className="bp-info">
            <div className="bp-title">{currentTrack?.title || '未在播放'}</div>
            <div className="bp-artist">{currentTrack?.artist || ''}</div>
          </div>
        </div>

        {/* 中间：播放控制 */}
        <div className="bp-center">
          <div className="bp-controls">
            <button
              className={`bp-btn bp-shuffle${isShuffle ? ' active' : ''}`}
              onClick={() => { setIsShuffle(s => { const v = !s; if (v) { shuffleOrderRef.current = generateShuffleOrder(); showToast('随机播放已开启'); } else showToast('顺序播放'); return v; }); }}
              title="随机播放 (S)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
                <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
                <line x1="4" y1="4" x2="9" y2="9"/>
              </svg>
            </button>

            <button className="bp-btn" onClick={playPrev} title="上一首">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
            </button>

            <button className="bp-btn-play" onClick={togglePlay} title="播放 / 暂停 (Space)">
              {isPlaying
                ? <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                : <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              }
            </button>

            <button className="bp-btn" onClick={playNext} title="下一首">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
            </button>

            <button
              className={`bp-btn bp-repeat${repeatMode >= 1 ? ' active' : ''}${repeatMode === 2 ? ' repeat-one' : ''}`}
              onClick={() => setRepeatMode(m => { const v = (m + 1) % 3; if (v === 1) showToast('列表循环'); else if (v === 2) showToast('单曲循环'); else showToast('循环关闭'); return v; })}
              title="循环模式 (R)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/>
                <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
              </svg>
            </button>
          </div>
          <div className="bp-progress" onClick={handleProgressClick}>
            <span className="bp-time">{currentTime}</span>
            <div className="bp-progress-bar">
              <div className="bp-progress-fill" style={{ width: progress + '%' }}></div>
            </div>
            <span className="bp-time">{duration}</span>
          </div>
        </div>

        {/* 右侧：音量 */}
        <div className="bp-right">
          <span className="bp-volume-icon" onClick={() => { if (volume > 0) { lastVolRef.current = volume; setVolume(0); } else setVolume(lastVolRef.current || 0.7); }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              {volume === 0
                ? <><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></>
                : volume < 0.5
                  ? <path d="M15.54 8.46a5 5 0 010 7.07"/>
                  : <><path d="M19.07 4.93a10 10 0 010 14.14"/><path d="M15.54 8.46a5 5 0 010 7.07"/></>
              }
            </svg>
          </span>
          <div className="bp-volume-slider" onClick={handleVolumeClick}>
            <div className="bp-volume-fill" style={{ width: (volume * 100) + '%' }}></div>
          </div>
        </div>
      </div>

      {/* 消息面板 */}
      {showMessagePanel && (
        <div className="panel-overlay" onClick={() => setShowMessagePanel(false)}>
          <div className="panel-card" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <h3>消息中心</h3>
              <button className="panel-close" onClick={() => setShowMessagePanel(false)}>×</button>
            </div>
            <div className="panel-body">
              <div className="message-list">
                <div className="message-item">
                  <div className="message-avatar">🎵</div>
                  <div className="message-content">
                    <div className="message-title">系统通知</div>
                    <div className="message-text">您的歌曲已成功发布！</div>
                    <div className="message-time">5分钟前</div>
                  </div>
                </div>
                <div className="message-item">
                  <div className="message-avatar">👥</div>
                  <div className="message-content">
                    <div className="message-title">好友动态</div>
                    <div className="message-text">小明发布了新歌曲《夏日回忆》</div>
                    <div className="message-time">1小时前</div>
                  </div>
                </div>
                <div className="message-item unread">
                  <div className="message-avatar">🔔</div>
                  <div className="message-content">
                    <div className="message-title">系统更新</div>
                    <div className="message-text">新版本 v2.0 已发布，新增主题切换功能</div>
                    <div className="message-time">2小时前</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 设置面板 */}
      {showSettingsPanel && (
        <div className="panel-overlay" onClick={() => setShowSettingsPanel(false)}>
          <div className="panel-card settings-panel" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <h3>主题设置</h3>
              <button className="panel-close" onClick={() => setShowSettingsPanel(false)}>×</button>
            </div>
            <div className="panel-body">
              <div className="settings-section">
                <h4>选择主题</h4>
                <div className="theme-options">
                  <button 
                    className={`theme-option${theme === 'dark' ? ' active' : ''}`}
                    onClick={() => setTheme('dark')}
                  >
                    <div className="theme-preview dark-preview"></div>
                    <span>深色主题</span>
                  </button>
                  <button 
                    className={`theme-option${theme === 'light' ? ' active' : ''}`}
                    onClick={() => setTheme('light')}
                  >
                    <div className="theme-preview light-preview"></div>
                    <span>浅色主题</span>
                  </button>
                  <button 
                    className={`theme-option${theme === 'ocean' ? ' active' : ''}`}
                    onClick={() => setTheme('ocean')}
                  >
                    <div className="theme-preview ocean-preview"></div>
                    <span>海洋主题</span>
                  </button>
                </div>
              </div>
              <div className="settings-section">
                <h4>其他设置</h4>
                <div className="settings-item">
                  <span>自动播放</span>
                  <label className="toggle-switch">
                    <input type="checkbox" defaultChecked />
                    <span className="slider"></span>
                  </label>
                </div>
                <div className="settings-item">
                  <span>显示可视化效果</span>
                  <label className="toggle-switch">
                    <input type="checkbox" defaultChecked />
                    <span className="slider"></span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 个人信息面板 */}
      {showProfilePanel && (
        <div className="panel-overlay" onClick={() => setShowProfilePanel(false)}>
          <div className="panel-card profile-panel" onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <h3>个人信息</h3>
              <button className="panel-close" onClick={() => setShowProfilePanel(false)}>×</button>
            </div>
            <div className="panel-body">
              <div className="profile-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <div className="profile-info">
                <h2>{user?.email?.split('@')[0] || '用户'}</h2>
                <p>{user?.email}</p>
              </div>
              <div className="profile-stats">
                <div className="stat-item">
                  <span className="stat-value">12</span>
                  <span className="stat-label">发布歌曲</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">256</span>
                  <span className="stat-label">收藏</span>
                </div>
                <div className="stat-item">
                  <span className="stat-value">89</span>
                  <span className="stat-label">关注者</span>
                </div>
              </div>
              <button className="profile-edit-btn">编辑个人资料</button>
            </div>
          </div>
        </div>
      )}

      {/* 隐藏 Audio 元素 */}
      <audio ref={audioRef} preload="auto" />
    </>
  );
}

export default App;
