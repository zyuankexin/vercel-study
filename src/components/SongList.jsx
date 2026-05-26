import { useRef } from 'react';

function SongList({ songs, currentIndex, loading, error, searchText, onSearchChange, onSelectTrack, onFileUpload }) {
  const fileInputRef = useRef(null);

  // 搜索过滤
  const lower = searchText.toLowerCase();
  const filtered = songs.filter(
    t => t.title.toLowerCase().includes(lower) || t.artist.toLowerCase().includes(lower)
  );

  // 拖拽上传
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files.length) onFileUpload(e.dataTransfer.files);
  };
  const handleDragOver = (e) => { e.preventDefault(); };
  const handleFileChange = (e) => {
    if (e.target.files.length) { onFileUpload(e.target.files); e.target.value = ''; }
  };

  return (
    <div className="playlist-panel">
      <div className="playlist-header">
        <h2>播放列表</h2>
        <div className="search-box">
          <span className="search-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </span>
          <input type="text" placeholder="搜索歌曲..." value={searchText} onChange={e => onSearchChange(e.target.value)} />
        </div>
      </div>

      <div className="playlist-list">
        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <div>正在加载歌曲列表…</div>
          </div>
        ) : !filtered.length ? (
          <div className="no-results">{searchText ? '未找到匹配歌曲' : '播放列表为空'}</div>
        ) : (
          filtered.map(track => {
            const realIdx = songs.indexOf(track);
            return (
              <div
                key={track.id}
                className={`playlist-item${realIdx === currentIndex ? ' active' : ''}`}
                onClick={() => onSelectTrack(realIdx)}
              >
                <div className="pl-thumb">
                  {track.coverUrl
                    ? <img src={track.coverUrl} alt="" />
                    : <div className="pl-placeholder" style={{ background: track.color || '#1a1a3e' }}>🎵</div>
                  }
                </div>
                <div className="pl-info">
                  <div className="pl-title">{track.title}</div>
                  <div className="pl-artist">{track.artist}</div>
                </div>
                <span className="pl-duration">{track.duration || '--:--'}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="upload-zone">
        <label className="upload-area" onClick={() => fileInputRef.current?.click()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <div>拖拽或点击上传音乐文件</div>
          <input ref={fileInputRef} type="file" accept="audio/*" multiple style={{ display: 'none' }} onChange={handleFileChange} />
        </label>
      </div>

      {/* 拖拽区域 */}
      <div style={{ display: 'none' }} onDrop={handleDrop} onDragOver={handleDragOver} />
    </div>
  );
}

export default SongList;
