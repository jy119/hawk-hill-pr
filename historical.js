/* Hawk Hill historical analysis. Separate from the existing week-lookahead logic. */
(() => {
  const rows = [["J K","2025-09-23","5:17",483],["Jovanni Stefani","2023-10-05","5:27",null],["Harry Elworthy","2025-09-23","5:32",465],["elevin 11","2024-10-01","5:34",432],["BERTOTWERKS","2016-02-11","5:46",497],["Phil Gaimon","2017-03-06","5:46",526],["Josef Nelson","2024-10-01","5:46",493],["Evan Arthur","2024-11-06","5:47",438],["Ivan Linser","2025-09-23","5:49",380],["Dan McGarry","2023-10-05","5:52",387],["Edwin Park","2020-10-16","5:53",414],["Jim Whimpey","2013-03-29","6:00",461],["Ben Herken","2024-10-01","6:01",418],["Toby Hassett","2025-01-29","6:02",480],["Reed Horton","2024-10-01","6:04",424],["Aymen El Gorani","2025-09-23","6:04",421],["Niels Knipp","2016-02-08","6:05",440],["Matthew Wiebe","2020-02-11","6:07",450],["Colin Kwiecinski","2024-10-01","6:08",506],["Andrew Holmes","2018-11-09","6:09",482],["Eric Colindres","2024-09-27","6:10",441]];
  const root = document.getElementById('historicalAnalysis');
  if (!root) return;
  const dates = [...new Set(rows.map(r => r[1]))].sort();
  const dateMap = {};
  const windFrom = deg => ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(deg/22.5)%16];
  const norm = d => ((d%360)+360)%360;
  const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const formatDate = s => new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const stat = document.getElementById('historicalStatus');
  const tbody = document.getElementById('historicalRows');
  const daybox = document.getElementById('historicalDays');
  const refresh = document.getElementById('historicalRefresh');
  function render() {
    const known = Object.values(dateMap).filter(v=>v && !v.error);
    const failed = Object.values(dateMap).filter(v=>v && v.error).length;
    stat.textContent = known.length ? `Loaded ${known.length}/${dates.length} effort dates (7, 8 and 9 AM Pacific). ${failed ? failed+' dates unavailable. ' : ''}Historical reanalysis at Hawk Hill, not observed wind at the rider.` : 'Fetching historical wind…';
    tbody.innerHTML = rows.map((r,i) => {
      const w=dateMap[r[1]], has=w && !w.error;
      const wind=has ? `${w.speed.toFixed(1)} mph · ${windFrom(w.dir)} (${Math.round(w.dir)}°)` : (w?.error ? 'Unavailable' : 'Loading…');
      return `<tr><td>${i+1}</td><td>${escape(r[0])}</td><td>${formatDate(r[1])}</td><td><strong>${r[2]}</strong></td><td>${r[3] || '—'}</td><td>${wind}</td><td>${has ? w.gust.toFixed(1)+' mph' : '—'}</td></tr>`;
    }).join('');
    daybox.innerHTML = dates.map(d=>{
      const w=dateMap[d];
      return `<div class="history-day"><div class="history-day-date">${formatDate(d)}</div><strong>${!w?'Loading…':w.error?'Unavailable':w.speed.toFixed(1)+' mph '+windFrom(w.dir)}</strong><span>${w&&!w.error?'7–9 AM · peak gust '+w.gust.toFixed(1)+' mph':''}</span></div>`;
    }).join('');
  }
  async function load() {
    refresh.disabled = true;
    Object.keys(dateMap).forEach(k => delete dateMap[k]);
    render();
    // Query each day individually so archived dates spanning 2013–2025 are never inadvertently averaged across days.
    const fetchDay=async d=>{
      const qs=new URLSearchParams({latitude:'37.8306',longitude:'-122.4908',start_date:d,end_date:d, hourly:'wind_speed_10m,wind_direction_10m,wind_gusts_10m',wind_speed_unit:'mph',timezone:'America/Los_Angeles',models:'era5'});
      const url='https://archive-api.open-meteo.com/v1/archive?'+qs;
      for(let attempt=0; attempt<2; attempt++){
        try {
          const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),18000);
          let response;
          try { response=await fetch(url,{signal:controller.signal}); } finally {clearTimeout(timer);}
          if(!response.ok) throw Error('Historical API '+response.status);
          const json=await response.json();
          if(json.error)throw Error(json.reason||'Weather API unavailable');
          const h=json.hourly||{};
          const samples=(h.time||[]).map((t,i)=>({hour:+t.substring(11,13),speed:h.wind_speed_10m?.[i],dir:h.wind_direction_10m?.[i],gust:h.wind_gusts_10m?.[i]})).filter(x=>x.hour>=7&&x.hour<=9&&Number.isFinite(x.speed)&&Number.isFinite(x.dir));
          if(!samples.length)throw Error('No hourly records');
          const rad=samples.map(x=>x.dir*Math.PI/180);
          const dx=samples.reduce((s,x,i)=>s+Math.sin(rad[i])*x.speed,0),dy=samples.reduce((s,x,i)=>s+Math.cos(rad[i])*x.speed,0);
          dateMap[d]={speed:samples.reduce((s,x)=>s+x.speed,0)/samples.length,dir:norm(Math.atan2(dx,dy)*180/Math.PI),gust:Math.max(...samples.map(x=>x.gust??x.speed))};
          render();return;
        } catch(e) { if(attempt===1){dateMap[d]={error:String(e.message||e)};render();} }
      }
    };
    // Small batches avoid overloading the archive API.
    for(let i=0;i<dates.length;i+=3) await Promise.all(dates.slice(i,i+3).map(fetchDay));
    refresh.disabled=false;
    if(Object.values(dateMap).every(x=>x.error)) stat.textContent='Could not reach the Open-Meteo historical archive. Try Refresh historical data. No wind values have been estimated or invented.';
  }
  refresh?.addEventListener('click',load);
  render();
  load();
})();