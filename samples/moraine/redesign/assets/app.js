/* Moraine Lake, three.js r147 (UMD). Terreno do DEM real exportado do Blender, céu autoral, reflexo planar,
   floresta instanciada, pós em cadeia fixa. Única interação: órbita limitada. */
(function () {
'use strict';
const META = window.D_META;
const Q = new URLSearchParams(location.search);
// base64 -> bytes num laço direto (o Uint8Array.from com função por caractere levava segundos nos 100 MB do terreno e das árvores)
const B64 = Q.has('olddecode') ? (s => Uint8Array.from(atob(s), c => c.charCodeAt(0))) : s => { const b = atob(s), n = b.length, u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = b.charCodeAt(i); return u; };
const LT = k => { if (Q.has('loadlog')) console.log('LOADLOG ' + k + ' ' + Math.round(performance.now()) + ' ms'); };
LT('app.js inicio');
const FIXED_T = Q.has('t') ? parseFloat(Q.get('t')) : null;
const SHOT = Q.has('shot') || FIXED_T !== null;
const DEG = Math.PI / 180;

/* ---------- direção de arte: tudo que o loop ajusta mora aqui ---------- */
const TUNE = window.TUNE_OVERRIDE || {
  exposure: 1.0,
  // cores-alvo em sombra (sRGB), luz de céu já embutida
  tenPeaks: '#9a5e55', central: '#76595a', leftWall: '#2b211c', leftWallBand: '#4a3a30',
  talusLeft: '#8e7a6c', talusCenter: '#a88a80', snowShade: '#c4adab', snowLit: '#ffd9bf',
  forestFloor: '#1b2414', moss: '#56643a', sunRock: '#f1761f', sunRock2: '#c9703f',
  tree: '#1a1d11', treeLit: '#3a4426',   // copa verde oliva escuro, ponta verde mais clara (defeito 4)
  waterBody: '#20aec2', waterShallow: '#2db3bd', waterDeep: '#0b587a',
  reflBase: 0.48, reflGain: 1.0, reflTint: '#d6f0f4', rippleAmp: 0.85,   // região 13: espelho liso
  haze: 0.2, hazeDist: 8000,   // igual à névoa do render do Cycles (começa em 2,5 km)
  strata: 0.42, detail: 0.85,
  bakeExp: 1.25,
  skyRot: -5, skyDrift: 0.0045, skyContrast: 2.0, skyChroma: 0.2, skyGain: 1.14,
};
const SKY_KEYS = [ // [x%, y%, cor] autoria a partir do manifesto (paleta medida), não amostra da foto
  [12, 2, '#8e95a6'], [15, 10, '#8f93a5'], [21, 7, '#9a97a8'], [22, 13, '#8c8294'], [25, 6, '#9e9aab'],
  [30, 2, '#a7a5b6'], [35, 4, '#aeaabb'], [42, 8, '#bdb0bb'], [44, 18, '#c9b2b7'], [38, 12, '#b9aab6'],
  [50, 3, '#c4b2bb'], [50, 14, '#d4b3b3'], [55, 22, '#e2a898'], [57, 10, '#deaa9f'], [62, 4, '#d8a8a0'],
  [65, 14, '#eba48f'], [68, 24, '#eda08b'], [72, 8, '#e9a693'], [75, 14, '#f2a68c'], [78, 20, '#f39a78'],
  [82, 4, '#e3a091'], [85, 17, '#f6966c'], [88, 9, '#e69a86'], [92, 19, '#f4a07c'], [95, 5, '#d99a8c'],
  [98, 14, '#d39183'], [98, 23, '#c98d8b'], [80, 23, '#ec9c86'], [60, 24, '#e6a092'], [47, 24, '#d9a8a2'],
  [5, 0, '#8a91a3'], [70, 0, '#dba79c'], [100, 0, '#d7998b'],
];

const lin = h => { const c = new THREE.Color(h); return new THREE.Vector3(Math.pow(c.r, 2.2), Math.pow(c.g, 2.2), Math.pow(c.b, 2.2)); };
// THREE.Color(h) em r147 sem ColorManagement guarda o valor sRGB cru; convertemos à mão.

/* ---------- renderer ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: SHOT });
// teste de carregamento a frio (?coldtest): um comentário único em cada shader impede o cache de programas do Chrome
if (Q.has('coldtest')) { const RND = Math.random().toString(36).slice(2); THREE.Material.prototype.onBeforeCompile = s => { s.fragmentShader = '// ' + RND + '\n' + s.fragmentShader; }; THREE.Material.prototype.customProgramCacheKey = () => RND; }
renderer.setPixelRatio(SHOT ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.LinearEncoding;
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const mirrorScene = scene;

/* ---------- câmera travada (mesma marca CAM_FOTO do Blender) ---------- */
const C = META.cam;
const camera = new THREE.PerspectiveCamera(50, 1.5, 1.5, 26000);
const camPos0 = new THREE.Vector3(C.x, C.z, -C.y);
const fwd = new THREE.Vector3(Math.sin(C.yaw * DEG) * Math.cos(C.pitch * DEG), Math.sin(C.pitch * DEG), -Math.cos(C.yaw * DEG) * Math.cos(C.pitch * DEG));
camera.position.copy(camPos0);
/* redo: câmera de VISÃO mais aberta que a CAM_FOTO (picos casando com a foto a 50%); a CAM_FOTO continua sendo a de projeção.
   VIEW_S < 1 abre o campo (escala do quadro), VIEW_DP sobe a mira em graus. ?vs= e ?vdp= testam outros valores. */
const VIEW_S = Q.has('vs') ? parseFloat(Q.get('vs')) : 0.96, VIEW_DP = Q.has('vdp') ? parseFloat(Q.get('vdp')) : 0.12;
const fwdV = new THREE.Vector3(Math.sin(C.yaw * DEG) * Math.cos((C.pitch + VIEW_DP) * DEG), Math.sin((C.pitch + VIEW_DP) * DEG), -Math.cos(C.yaw * DEG) * Math.cos((C.pitch + VIEW_DP) * DEG));
const targetRef = camPos0.clone().addScaledVector(fwd, 700);
const target0 = camPos0.clone().addScaledVector(fwdV, 700);
/* enquadramento travado igual à foto: 3:2 com letterbox (faixa preta onde a janela sobrar), FOV da CAM_FOTO */
const FRAME_A = 1.5;
function viewSize() { const W = window.innerWidth, H = window.innerHeight; return W / H > FRAME_A ? [Math.round(H * FRAME_A), H] : [W, Math.round(W / FRAME_A)]; }
function setFov(ref) {
  const a = FRAME_A; camera.aspect = a;
  camera.fov = 2 * Math.atan(Math.tan(C.hfov * DEG / 2) / a / (ref ? 1 : VIEW_S)) / DEG; camera.updateProjectionMatrix();
}
setFov();
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.target.copy(target0); controls.enableZoom = false; controls.enablePan = false;
controls.enableDamping = true; controls.dampingFactor = 0.06; controls.rotateSpeed = 0.22;
controls.update();
const az0 = controls.getAzimuthalAngle(), po0 = controls.getPolarAngle();
camera.lookAt(target0); camera.rotateZ(C.roll * DEG); camera.updateMatrixWorld();
const REF_BASIS = [new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate()];
controls.minAzimuthAngle = az0 - 0.04; controls.maxAzimuthAngle = az0 + 0.025;   // pedido do usuário: girando pra direita não mostra a ponta serrilhada do penhasco   // pedido do usuário: girando pra esquerda não revela a encosta lisa da direita
controls.minPolarAngle = po0 - 0.07; controls.maxPolarAngle = po0 + 0.025;
if (!Q.has('oldorbita')) {
  // pedido ("isso ficou estranho", "limita pra não ver isso"): inclinando a câmera o reflexo ganhava uma faixa vinho e o pico
  // refletido escurecia (o render das montanhas é projetado da câmera da foto e só vale perto dela), e na borda apareciam pedaços
  // soltos. Órbita menor: lado -1,4° a +1,1°, vertical -1,1° a +0,7° (?oldorbita volta os limites antigos)
  controls.minAzimuthAngle = az0 - 0.025; controls.maxAzimuthAngle = az0 + 0.02;
  // v4 (pedido: "fica estranho quando desce a câmera, fica estourado e roxo"): a inclinação vertical quebra o reflexo dos dois
  // lados (o render das montanhas é projetado da câmera da foto); fica quase travada, ±0,17°
  controls.minPolarAngle = po0 - 0.003; controls.maxPolarAngle = po0 + 0.003;
}
if (SHOT) controls.enabled = false;
// conferência de órbita (só print): ?oaz= e ?opo= deslocam a câmera em azimute/polar como a órbita faria (limites ±0,16 / -0,07..+0,025)
if (Q.has('oaz') || Q.has('opo')) {
  const off = camera.position.clone().sub(controls.target); const sp = new THREE.Spherical().setFromVector3(off);
  sp.theta += parseFloat(Q.get('oaz') || 0); sp.phi += parseFloat(Q.get('opo') || 0); off.setFromSpherical(sp);
  camera.position.copy(controls.target).add(off);
}
const ROLL = C.roll * DEG;

/* ---------- uniforms compartilhados ---------- */
const U = {
  time: { value: 0 }, yaw: { value: C.yaw * DEG }, camRef: { value: camPos0.clone() },
  /* passo 1: tone mapping ACES + sRGB exato + dithering (?tmold volta ao antigo); tmK segura os meios-tons no mesmo lugar */
  tmA: { value: Q.has('tmaces') ? 1 : Q.has('tmsrgb') ? 2 : 0 }, tmK: { value: 0.72 },   /* passo 1 perdeu 2x (ACES 68%, sRGB 58%): curva original */
  /* pedido: sem a linha do canto de cima à esquerda (?linha volta) */ partL: { value: Q.has('linha') ? 0 : 1 },
  /* passo 2: anti-aliasing das árvores por alpha to coverage no MSAA 4x (?noaa desliga) */ aaT: { value: Q.has('noaa') ? 0 : 1 },
  skyTex: { value: null },
};
const GLSL_COMMON = `
float hash12(vec2 p){ vec3 p3=fract(vec3(p.xyx)*.1031); p3+=dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
float fbm3(vec2 p){ ${Q.has('ct_fbm') ? 'return 0.5 + 0. * p.x;' : ''} float s=0., a=.5; for(int i=0;i<3;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
vec3 toLin(vec3 c){ return pow(c, vec3(2.2)); }
uniform sampler2D skyTex; uniform float yaw;
// céu: textura (azimute relativo, elevação) -> cor linear
vec3 skyBase(vec3 d){
  float az = atan(d.x, -d.z) - yaw; az = atan(sin(az), cos(az));
  float el = asin(clamp(d.y,-1.,1.));
  vec2 uv = vec2(az/3.14159*0.5+0.5, clamp((el+0.1745)/1.0472, 0., 1.));
  return texture2D(skyTex, uv).rgb;
}
`;

/* ---------- textura do céu: IDW a partir das chaves do manifesto ---------- */
function buildSkyTex() {
  const W = 256, H = 128, data = new Float32Array(W * H * 4);
  const F = 1000 / Math.tan(C.hfov * DEG / 2);
  const keys = SKY_KEYS.map(([x, y, h]) => {
    const u = x * 20 - 1000, v = 666.5 - y * 13.33;
    const az = Math.atan2(u, F), el = C.pitch * DEG + Math.atan2(v, Math.hypot(F, u));
    return [az, el, lin(h)];
  });
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const az = (i / (W - 1) - 0.5) * 2 * Math.PI, el = -0.1745 + (j / (H - 1)) * 1.0472;
    let sw = 0; const acc = [0, 0, 0];
    for (const [ka, ke, c] of keys) {
      let da = ka - az; da = Math.atan2(Math.sin(da), Math.cos(da));
      const d2 = da * da * 0.6 + (ke - Math.max(el, -0.02)) ** 2 + 1e-5, w = 1 / (d2 * d2);
      acc[0] += c.x * w; acc[1] += c.y * w; acc[2] += c.z * w; sw += w;
    }
    // acima de ~30 graus o céu escurece pro azul do alto
    const up = Math.max(0, Math.min(1, (el - 0.42) / 0.5));
    const k = (j * W + i) * 4;
    data[k] = acc[0] / sw * (1 - up) + 0.20 * up; data[k + 1] = acc[1] / sw * (1 - up) + 0.24 * up;
    data[k + 2] = acc[2] / sw * (1 - up) + 0.36 * up; data[k + 3] = 1;
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  t.magFilter = t.minFilter = THREE.LinearFilter; t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true;
  return t;
}
U.skyTex.value = buildSkyTex();

/* ---------- céu ---------- */
const skyMat = new THREE.ShaderMaterial({
  uniforms: { time: U.time, yaw: U.yaw, skyTex: U.skyTex, tSky: { value: null }, skyRot: { value: TUNE.skyRot * DEG }, skyDrift: { value: TUNE.skyDrift }, skyContrast: { value: TUNE.skyContrast }, skyChroma: { value: TUNE.skyChroma }, skyGain: { value: TUNE.skyGain }, tCloud: { value: null }, skyDbg: { value: Q.has('skydbg') ? 1 : 0 }, skyS: { value: Q.has('skyold') ? 0 : 1 } /* passo 5: nuvem macia e cor da foto */, skyRot2: { value: 27 * DEG }, refF: { value: new THREE.Vector3() }, refR: { value: new THREE.Vector3() }, refU: { value: new THREE.Vector3() }, refFoc: { value: 1000 / Math.tan(C.hfov * DEG / 2) } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position = p.xyww; }`,
  fragmentShader: GLSL_COMMON + `
  uniform float skyDbg, skyRot2, skyS; uniform float time, skyRot, skyDrift, skyContrast, skyChroma, skyGain, refFoc; uniform sampler2D tCloud; uniform vec3 refF, refR, refU; uniform sampler2D tSky; varying vec3 vDir;
  void main(){
    vec3 d = normalize(vDir);
    vec3 pal = skyBase(d);                             // paleta medida da foto (alto à esquerda #8e94a1, massa da direita #f1a895/#e29885)
    // forma e volume da nuvem vêm do puresky real (belfast_sunset_puresky), girado e com deriva lenta
    float azW = atan(d.x, -d.z);
    float el = asin(clamp(d.y, 0., 1.));
    vec2 suv = vec2(fract((azW + skyRot + time*skyDrift) / 6.28318), clamp(el / 1.5708, 0.002, 0.998));
    // bloco 4: a nuvem muda de forma devagar enquanto anda (deformação do domínio que evolui no tempo), não desliza em bloco
    if (${Q.has('nomorph') ? 'false' : 'true'}) suv += (vec2(fbm3(suv * vec2(40., 14.) + vec2(time * 0.014, 0.)), fbm3(suv * vec2(40., 14.) + vec2(5.2, time * 0.011))) - 0.5) * vec2(0.007, 0.005);   // pedido: céu parecia parado, forma muda mais
    vec3 h0 = toLin(texture2D(tSky, suv).rgb);
    vec3 hb = toLin(texture2D(tSky, suv, 5.5).rgb);
    float l0 = dot(h0, vec3(0.2126, 0.7152, 0.0722)), lb = dot(hb, vec3(0.2126, 0.7152, 0.0722));
    float detail = pow(l0 / max(lb, 1e-4), skyContrast);
    vec3 chroma = h0 / max(l0, 1e-4);
    // máscara de nuvem pintada nas coordenadas do quadro de referência (a nuvem fica presa ao céu na órbita)
    float zf = dot(d, refF);
    vec2 fq = vec2(0.5 + refFoc * dot(d, refR) / max(zf, 1e-3) / 2000., 0.5 - refFoc * dot(d, refU) / max(zf, 1e-3) / 1333.);
    vec2 muv = vec2((fq.x + 0.4) / 1.8, 1. - (fq.y + 0.4) / 1.0);
    vec4 cm = zf > 0.05 ? texture2D(tCloud, muv) : vec4(0.);
    // estrutura de escala grande: a máscara pintada decide onde há nuvem; o puresky só esfiapa a borda (frequência média, sem flocos)
    float lmid = dot(toLin(texture2D(tSky, suv, skyS > 0.5 ? 4.0 : 2.2).rgb), vec3(0.2126, 0.7152, 0.0722));   // passo 5: forma da nuvem de um nível mais macio
    float lbig = dot(toLin(texture2D(tSky, suv, 7.0).rgb), vec3(0.2126, 0.7152, 0.0722));
    float det = lmid / max(lbig, 1e-4) - 1.0;
    float lglob = dot(toLin(texture2D(tSky, suv, 10.0).rgb), vec3(0.2126, 0.7152, 0.0722));
    float dH = smoothstep(0.02, 0.32, 1.0 - lmid / max(lglob, 1e-4));            // massa real de nuvem do puresky (contorno e lóbulo)
    // segunda leitura do puresky, girada, traz a massa real de nuvem pra esquerda e pro centro
    vec2 suv2 = vec2(fract((azW + skyRot2 + time*skyDrift*0.8) / 6.28318), suv.y);
    float lmid2 = dot(toLin(texture2D(tSky, suv2, skyS > 0.5 ? 4.0 : 2.2).rgb), vec3(0.2126, 0.7152, 0.0722));
    float lgl2 = dot(toLin(texture2D(tSky, suv2, 10.0).rgb), vec3(0.2126, 0.7152, 0.0722));
    float dH2 = smoothstep(0.02, 0.32, 1.0 - lmid2 / max(lgl2, 1e-4));
    float rightW = smoothstep(-0.3, 0.35, dot(d, refR));
    float dHc = max(dH * (0.35 + 0.65 * rightW), dH2 * (1.0 - 0.7 * rightW));
    float dens = clamp(dHc * (0.75 + 0.6 * smoothstep(0.1, 0.55, cm.r)) * 1.3 - cm.b * 0.3, 0., 1.);
    // estria fina na diagonal, mais forte na massa da direita
    vec2 sq = vec2(dot(d, refR), dot(d, refU));
    float str = fbm3(vec2((sq.x * 0.55 - sq.y) * 60., (sq.x + sq.y * 0.55) * 7.) + time * 0.01);
    dens = clamp(dens + (str - 0.5) * 0.55 * rightW, 0., 1.);
    if (${Q.has('oldburaco') ? 'false' : 'true'}) dens = max(dens, 0.45 * smoothstep(-0.1, 0.3, dot(d, refR)));   // erro 5: buracos do puresky viravam manchinhas azuis soltas no céu rosado (v2: piso menor)
    float right = smoothstep(-0.38, 0.5, dot(d, refR));
    dens = mix(smoothstep(0.02, 0.75, dens) * 0.85, skyS > 0.5 ? smoothstep(0.06, 0.72, dens) : smoothstep(0.18, 0.46, dens), right);   // passo 5: borda macia   // esquerda: véu macio e claro; direita: massa salmão com borda definida
    // céu limpo: azul acinzentado frio no alto à esquerda, pêssego pálido à direita
    vec3 clearC = mix(pal * (skyS > 0.5 ? vec3(0.84, 1.06, 1.1) * 1.1 : vec3(0.96, 1.03, 1.12)) * 1.08, pal * vec3(0.92, 0.88, 1.02) * 0.95, right);
    // nuvem: tufos malva mais escuros à esquerda, massa salmão lisa à direita, com gradiente suave e lado aceso
    vec3 cloudC = mix(pal * (skyS > 0.5 ? vec3(0.95, 1.0, 1.04) : vec3(1.06, 0.95, 0.98)) * 1.04, pal * (skyS > 0.5 ? vec3(1.55, 0.84, 0.64) : vec3(1.42, 0.90, 0.72)) * 1.22, right);   // ponto 12: laranja salmão aceso (#f1a895, #e29885)
    cloudC *= mix(1.02 + 0.35 * clamp(-det, -0.3, 0.4), 0.8 + 1.2 * clamp(-det, -0.3, 0.4) + 0.3 * (1.0 - dHc), right);   // borda acesa, miolo um pouco mais denso
    float under = smoothstep(0.10, 0.20, fq.y) * (1. - smoothstep(0.24, 0.30, fq.y));   // parte de baixo da massa, logo acima dos picos
    const bool RS = ${Q.has('oldceu') ? 'false' : 'true'};   // redo, peça céu (?oldceu volta)
    cloudC *= 1. + (RS ? 0.15 : 0.45) * under * right;                                     // acesa pelo sol baixo
    float kband = 0.;
    if (RS) {
      // alto à esquerda: nuvens cinza azuladas mais escuras, em camadas com contorno legível
      float lw = 1. - right;
      dens = mix(dens, smoothstep(0.15, 0.7, dens), lw * 0.6);
      cloudC = mix(cloudC, pal * vec3(0.80, 0.88, 1.0) * (0.95 + 0.15 * clamp(-det, -0.3, 0.4)), lw * smoothstep(0.0, 0.25, 0.32 - fq.y) * 0.8);   // volta 2: cinza azulado mais claro e fino
      clearC *= mix(vec3(1.), vec3(0.93, 0.99, 1.03) * vec3(1.35, 1.32, 1.1), lw);   // harmonizador + medido (céu esquerdo 15% escuro e azul demais)
      cloudC *= mix(vec3(1.), vec3(1.3, 1.28, 1.08), lw);
      // massa da direita: véu fibroso, estrias finas inclinadas no lugar das manchas de ruído grandes
      float fib = fbm3(vec2((sq.x * 0.5 - sq.y) * 140., (sq.x + sq.y * 0.5) * 9.) + time * 0.008);
      dens = clamp(dens * mix(1., 0.94 + 0.12 * fib, right), 0., 1.);   // volta 3: só um toque de estria (a versão forte virou mancha)
      // faixa de nuvem salmão acesa logo acima dos picos (foto: x 1160 a 1910, y 208 a 289 no quadro da CAM_FOTO), borda de baixo
      // nítida, de cima esfiapada, terminando num lóbulo redondo junto do pico da direita (no lugar do brilho amarelo antigo)
      float bn = fbm3(vec2(fq.x * 9. - time * 0.012, 1.3 + time * 0.01)) - 0.5, bn2 = fbm3(fq * vec2(60., 30.) + vec2(time * 0.006, 0.)) - 0.5;
      float bn3 = fbm3(vec2(fq.x * 26. - time * 0.03, 4.1 + time * 0.02)) - 0.5;
      float lowE = mix(0.178, 0.206, smoothstep(0.58, 0.9, fq.x)) + bn * 0.022 + bn3 * 0.012 + bn2 * 0.004;   // borda de baixo ondulada, subindo pra esquerda (referência da usuária)
      float thick = mix(0.035, 0.055, smoothstep(0.6, 0.75, fq.x) * (1. - smoothstep(0.85, 0.93, fq.x)));
      float topE = lowE - thick + bn2 * 0.02;
      float xk = smoothstep(0.565, 0.62, fq.x + bn * 0.03) * (1. - smoothstep(0.95, 0.975, fq.x));
      float kb = (1. - smoothstep(lowE - 0.008, lowE + 0.006, fq.y)) * smoothstep(topE - 0.03, topE + 0.02, fq.y) * xk;
      float kl = 1. - smoothstep(0.6, 1.05, length((fq - vec2(0.925, 0.182)) / vec2(0.04, 0.042)) + bn2 * 0.6);   // lóbulo fofo, inchado pra cima, junto do pico da direita
      kband = clamp(max(kb, kl), 0., 1.) * ${Q.has('oldnuvem') ? '1.' : '0.'};   // a faixa lisa sai: a massa de nuvem nova entra no fim
      float lit = clamp((fq.y - topE) / max(lowE - topE, 1e-3), 0., 1.);
      vec3 bandC = pal * vec3(1.55, 0.84, 0.64) * 1.22 * vec3(1.12, 0.95, 0.80) * (0.9 + 0.2 * lit);   // medido: massa de baixo 251,172,137
      // lóbulo: cabeça mais clara e rosada que a faixa, com volume (claro em cima, mais quente embaixo)
      float lyq = clamp((fq.y - 0.142) / 0.08, 0., 1.);
      vec3 lobeC = bandC * mix(vec3(1.06, 1.12, 1.22), vec3(1.0, 0.98, 0.96), lyq) * 1.04;
      bandC = mix(bandC, lobeC, smoothstep(0.2, 0.8, kl));
      cloudC = mix(cloudC, bandC, kband); dens = max(dens, kband);
    }
    vec3 c = mix(clearC, cloudC, dens) * skyGain;
    // franja acesa na borda da nuvem (rosa à esquerda, coral à direita)
    float fringe = clamp(dens * (1.0 - dens) * 4.0, 0., 1.);
    c += mix(vec3(0.28, 0.16, 0.18), vec3(0.45, 0.17, 0.07), right) * fringe * 0.35 * right * skyGain;
    float tl = dens;    c = mix(c, c * mix(vec3(1.), chroma, 0.6), skyChroma);
    // bloco 4: alto à direita rosa empoeirado como na foto (#CC9590 no canto, #D59087 logo abaixo), não laranja (#E79476);
    // a massa salmão logo acima dos picos fica como está
    if (${Q.has('oldsky') ? 'false' : 'true'}) c *= mix(vec3(1.), RS ? vec3(0.53, 0.86, 1.38) : vec3(0.62, 0.88, 1.45), (1. - smoothstep(0.02, 0.2, fq.y)) * smoothstep(0.1, 0.45, dot(d, refR)));   // medido: canto de cima à direita 212 x 194 no vermelho
    if (RS) c *= mix(mix(1., 0.88, smoothstep(-0.25, 0.1, dot(d, refR))), 1., kband);   // medido: meio e direita do céu 6% claros (fora da faixa acesa)
    if (${Q.has('oldnuvem') ? 'false' : 'true'}) {
      // pedido ("sim, nuvens"): a massa rosa-laranja da direita era uma faixa lisa e alta. Agora é uma nuvem com forma, no quadro da
      // CAM_FOTO: borda de baixo acesa e recortada em rolos, medida na foto (1208,333) (1312,328) (1485,285) (1625,281) (1760,286),
      // corpo de ~130 a 180 px que esfuma pra cima, rolos internos, lóbulo claro pousado no pico da direita (centro 1856,247),
      // céu lilás por baixo dela entre os picos e nuvem violeta escura na ponta direita. Cores = paleta medida na foto (sRGB da tela),
      // levadas pro linear pela inversa do pós (curva padrão), sem textura da foto. Anda devagar (?oldnuvem volta)
      vec2 P = fq * vec2(2000., 1333.); float x = P.x, tN = time * 0.004;
      // v4: borda de baixo medida coluna a coluna na foto (tools/cloud_edge.py), convertida pra CAM_FOTO
      float yB = x < 1229. ? mix(345., 317., clamp((x - 1100.) / 129., 0., 1.)) : (x < 1312. ? mix(317., 309., (x - 1229.) / 83.) : (x < 1396. ? mix(309., 321., (x - 1312.) / 84.) :
                 (x < 1479. ? mix(321., 308., (x - 1396.) / 83.) : (x < 1562. ? mix(308., 288., (x - 1479.) / 83.) : (x < 1604. ? mix(288., 276., (x - 1562.) / 42.) :
                 (x < 1687. ? mix(276., 289., (x - 1604.) / 83.) : (x < 1771. ? mix(289., 283., (x - 1687.) / 84.) : mix(283., 294., clamp((x - 1771.) / 60., 0., 1.)))))))));
      float sc = fbm3(vec2(x / 46. + tN * 3., 2.3)), sc2 = fbm3(vec2(x / 18. + tN * 5., 7.1));
      yB += (sc - 0.45) * 14. + (sc2 - 0.45) * 5.;                                              // rolos na borda de baixo
      float xs = smoothstep(1080., 1250., x + (fbm3(vec2(P.y / 30., 3.)) - 0.5) * 60.) * (1. - smoothstep(${Q.has('oldnuvem3') ? '1890., 1950.' : '1840., 1885.'}, x));   // v7: o corpo para no lóbulo; à direita, céu violeta (foto)
      float yT = yB - (130. + 50. * fbm3(vec2(x / 120. + tN, 5.5)));
      float thinR = ${Q.has('oldnuvem3') ? '1.' : 'mix(1., 0.62, smoothstep(1640., 1800., x))'};   // v9: à direita a nuvem é mais baixa (foto: ~90 px), violeta em cima
      float bil = fbm3(P / vec2(38., 26.) + vec2(tN * 4., 0.)), bil2 = fbm3(P / vec2(14., 10.) + vec2(tN * 6., 3.));
      float above = yB - P.y;                                                                   // px acima da borda de baixo
      float bot = ${Q.has('oldnuvem3') ? 'smoothstep(yB + 2.5, yB - 4., P.y)' : (Q.has('oldhoriz') ? 'smoothstep(yB + 6., yB - 10., P.y)' : 'smoothstep(yB + 16., yB - 16., P.y)')};   // revisão ("céu colado atrás das montanhas"): na foto o laranja passa pro lilás em ~30 px, sem degrau (?oldhoriz volta)
      // v2: o corpo claro vai até ~90 px e some no céu de cima (sem mistura pra outra cor, sem frestas escuras que liam como sujeira)
      float topK = 1. - smoothstep(95. * thinR, 185. * thinR, above + (bil - 0.5) * 50. + (fbm3(vec2(x / 70., 9.3)) - 0.5) * 40.);   // v4: perfil medido: salmão forte até ~75 px acima da borda
      float dC = bot * topK * xs;
      // v2: lóbulo no lugar medido (vista 1780-1874 x 227-285 = CAM centro 1820,240), borda de couve-flor, cor salmão da foto (252,156,112)
      // v5 (pedido: "a nuvem ficou estranha", lia como disco claro): lóbulo no lugar medido no recorte (vista 1815-1880 x 225-265,
      // encostado no topo do pico), mesma cor do corpo da nuvem com a borda de cima e da direita acesa, unido ao corpo pela esquerda
      // v6 (o lóbulo solto lia como mancha): na foto é a ponta da própria nuvem que sobe mais alta e mais clara junto do pico, com a
      // borda de cima e da direita bem definida contra o céu violeta. Lóbulo + coluna até o corpo, na cor clara de baixo da nuvem
      vec2 lc = vec2(1872., 236.), lr = vec2(44., 30.);
      float lo = length((P - lc) / lr) + (fbm3(P / 12. + tN * 5.) - 0.5) * 0.45 + (fbm3(P / 4.5) - 0.5) * 0.1;
      lo = min(lo, length((P - lc - vec2(-12., 38.)) / vec2(58., 34.)) + (fbm3(P / 12. + 3.3) - 0.5) * 0.4);   // desce até o corpo
      if (${Q.has('oldnuvem3') ? 'true' : 'false'}) lo = min(lo, length((P - lc - vec2(-60., 30.)) / vec2(50., 30.)) + (fbm3(P / 14. + 6.1) - 0.5) * 0.4);  // ponte pela esquerda: lia como mancha pálida (erro 3)
      float dL = 1. - smoothstep(0.78, 1.0, lo);
      vec3 rimD = vec3(252., 156., 116.) / 255., lowD = vec3(253., 166., 128.) / 255., upD = vec3(244., 164., 142.) / 255.;   // perfil da foto em x 1500
      if (${Q.has('oldnuvem3') ? 'false' : 'true'}) rimD = lowD * vec3(0.99, 0.96, 0.95);   // v10: sem a linha clara fina na borda de baixo (a foto é macia ali)
      vec3 cD = mix(mix(rimD, lowD, smoothstep(2., 14., above)), upD, smoothstep(60., 120., above)) * (0.975 + 0.04 * bil) * (0.99 + 0.02 * bil2);
      // v3: lóbulo com volume: topo à esquerda aceso (quase creme), base e lado direito mais quentes e escuros
      vec2 lq = (P - lc) / lr;
      // v7 (a borda acesa virou um anel): luz em degradê de cima à direita, sem contorno; salmão alaranjado da foto (252,156,112),
      // com menos azul que o céu em volta, pra destacar
      float rimL = clamp(0.5 - 0.5 * lq.y + 0.3 * lq.x, 0., 1.);
      vec3 lD = mix(vec3(250., 150., 108.) / 255., vec3(254., 176., 138.) / 255., rimL) * (0.98 + 0.04 * bil2);
      dL *= ${Q.has('oldnuvem3') ? '1.' : '1. - 0.25 * smoothstep(0.3, -0.6, lq.x)'};   // lóbulo: borda da direita nítida contra o violeta, a esquerda some no corpo
      cD = mix(cD, lD, dL);
      float dN = max(dC, dL);
      // céu por baixo da nuvem: lilás rosado à esquerda (221,158,149), lilás frio no vão sob o lóbulo (180,154,161)
      float belowK = ${Q.has('oldhoriz') ? 'smoothstep(yB + 2., yB + 10., P.y)' : 'smoothstep(yB - 14., yB + 20., P.y)'} * smoothstep(1120., 1200., x) * (1. - smoothstep(1880., 1920., x)) * (1. - dL);   // revisão: o lilás começa por baixo da nuvem, sem o vão claro que virava uma linha acesa
      vec3 bD = mix(vec3(221., 158., 149.), ${Q.has('oldvao') ? 'vec3(184., 154., 160.)' : 'vec3(178., 153., 164.)'}, smoothstep(1560., 1700., x)) / 255.;
      // nuvem violeta escura na ponta direita (162,122,126), borda macia
      float xE = ${Q.has('oldnuvem2') ? '1905.' : '1888.'} + (fbm3(vec2(P.y / 35., 1.1 + tN * 3.)) - 0.5) * 110. + (fbm3(P / 12.) - 0.5) * 25. + (P.y - 250.) * 0.15;   // v2: borda esquerda irregular, não parede; v7: encosta no lóbulo (foto: violeta logo à direita dele)
      float dR = smoothstep(xE - 60., xE + 60., x) * smoothstep(90., 190., P.y + (fbm3(P / 30. + 2.) - 0.5) * 60.) * (1. - smoothstep(300., 390., P.y + (bil - 0.5) * 60.));
      // v5 (as estrias liam como pincelada): céu violeta acinzentado liso e macio, só variação larga
      dR *= ${Q.has('oldnuvem2') ? '0.55 + 0.45 * smoothstep(0.3, 0.6, fbm3(vec2((P.x * 0.6 - P.y) / 25., (P.x + P.y * 0.6) / 140.) + tN * 2.))' : '0.8 * (0.85 + 0.15 * fbm3(P / 90. + tN))'};
      vec3 rD = vec3(166., 128., 134.) / 255. * (0.96 + 0.06 * fbm3(P / 60.));
      if (${Q.has('oldnuvem3') ? 'false' : 'true'}) { dR = clamp(dR / 0.62, 0., 1.); rD = vec3(158., 126., 134.) / 255. * (0.96 + 0.06 * fbm3(P / 60.)); }   // v8 medido: violeta da foto 158,127,135; aqui só ~60% (199,128,124)
      vec3 ipC = pow(min(cD, vec3(0.995)), vec3(2.2)); ipC = mix(ipC, 0.6 - 0.4 * log((1. - ipC) / 0.4), step(0.6, ipC));
      vec3 ipB = pow(bD, vec3(2.2)) * (0.97 + 0.06 * bil);
      vec3 ipR = pow(rD, vec3(2.2));
      c = mix(c, ipB, belowK * (${Q.has('oldvao') ? '0.85' : 'mix(0.85, 1., smoothstep(1620., 1680., x))'}));   // jogo dos erros: no vão entre os picos a foto é lilás azulado cheio (180,154,160), aqui ficava rosado (212,156,155)
      if (${Q.has('oldnuvem3') ? 'false' : 'true'}) {   // v9: céu violeta acinzentado acima da nuvem, à direita (foto 148,115,122 em cima, 158,127,135 do lado)
        float dU = smoothstep(1720., 1940., x + (fbm3(P / 70. + 1.3) - 0.5) * 200. + (fbm3(P / 18.) - 0.5) * 40.) * (1. - smoothstep(yB - 125., yB - 45., P.y + (fbm3(P / 30. + 4.) - 0.5) * 60.)) * smoothstep(20., 120., P.y);
        dR = max(dR, dU * 0.85);   // v10: borda larga e quebrada (a reta lia como bloco)
      }
      c = mix(c, ipR, dR * 0.9);
      c = mix(c, ipC, dN);
    }
    if (${Q.has('oldtufo') ? 'false' : 'true'}) {
      // jogo dos erros (canto de cima à esquerda, medido com meas_boxes): na foto há dois tufos de nuvem malva junto da borda do
      // paredão, o maior e mais escuro em (300, 57) da vista (135,132,146), o de cima em (410, 45) (163,161,174), um fiapo rosado
      // em (490, 152), e céu azul limpo à direita deles (179,195,207) com a faixa de cima mais escura (143,163,180). Aqui era céu
      // liso e um véu cinza malva no lugar do azul. No quadro da CAM_FOTO, andando devagar (?oldtufo volta)
      vec2 P2 = fq * vec2(2000., 1333.); float tT = time * 0.25;
      float zSky = smoothstep(400., 470., P2.x + (fbm3(P2 / 40.) - 0.5) * 60.) * (1. - smoothstep(610., 690., P2.x + (fbm3(P2 / 45. + 7.) - 0.5) * 50.)) * (1. - smoothstep(110., 190., P2.y + (fbm3(P2 / 50. + 2.) - 0.5) * 50.));
      c = mix(c, pow(vec3(181., 196., 207.) / 255., vec3(2.2)) * (0.97 + 0.06 * fbm3(P2 / 80. + time * 0.01)), zSky * 0.85);
      float zTop = (1. - smoothstep(5., 50., P2.y + (fbm3(P2 / 30. + 4.) - 0.5) * 30.)) * smoothstep(190., 250., P2.x) * (1. - smoothstep(400., 480., P2.x));
      c = mix(c, pow(vec3(145., 163., 180.) / 255., vec3(2.2)), zTop * 0.5);   // v3: só a faixa de cima (entre os tufos ficava escuro)
      // v2 (as duas manchas liam coladas, de contorno duro): na foto é uma massa só, grande e macia (vista 244-445 x 20-105), malva
      // à esquerda e rosada à direita, com estrias na diagonal, e dois fiapos rosados embaixo (vista 405-501 x 133-161)
      vec2 q1 = P2 - vec2(318. + tT, 33.); vec2 dg = normalize(vec2(1., 0.28));
      vec2 q1r = vec2(dot(q1, dg), dot(q1, vec2(-dg.y, dg.x)));
      float t1 = length(q1r / vec2(118., 46.)) + (fbm3(P2 / 38. + vec2(time * 0.01, 0.)) - 0.5) * 0.9 + (fbm3(P2 / 13. + 2.) - 0.5) * 0.35;
      float st1 = fbm3(vec2(q1r.x / 55., q1r.y / 6.) + vec2(time * 0.012, 1.7));                     // estrias ao longo da diagonal
      float k1 = (1. - smoothstep(0.25, 1.2, t1)) * (0.7 + 0.45 * st1);
      float rgt = smoothstep(300., 420., P2.x - tT + (fbm3(P2 / 30. + 5.) - 0.5) * 50.);
      vec3 mC = mix(vec3(136., 124., 139.), vec3(176., 152., 164.), rgt) / 255.;   // v3: mais malva e rosado (ficava azulado na mistura)
      mC = mix(mC, vec3(184., 153., 162.) / 255., rgt * smoothstep(0.5, 0.75, st1) * 0.6);
      c = mix(c, pow(mC, vec3(2.2)), clamp(k1, 0., 1.) * 0.9);
      float w1 = length((P2 - vec2(401. + tT, 116.)) / vec2(26., 7.5)) + (fbm3(P2 / 9. + 5.) - 0.5) * 0.6;
      float w2 = length((P2 - vec2(453. + tT, 127.)) / vec2(31., 8.5)) + (fbm3(P2 / 9. + 8.) - 0.5) * 0.6;
      float kw = max(1. - smoothstep(0.3, 1.1, w1), 1. - smoothstep(0.3, 1.1, w2));
      c = mix(c, pow(vec3(186., 157., 164.) / 255., vec3(2.2)), kw * 0.6);
    }
    if (${Q.has('oldceu2') ? 'false' : 'true'}) {
      // céu sobre o maciço da esquerda (vista 700-1120 x 100-320, 15 caixas): aqui ~6% claro e menos rosado que a foto (195,196,204
      // a 217,185,184 na foto, 213,205,212 a 222,195,193 aqui). Ganho medido no linear, borda larga (?oldceu2 volta)
      vec2 P3 = fq * vec2(2000., 1333.);
      float zC2 = smoothstep(640., 720., P3.x + (fbm3(P3 / 60.) - 0.5) * 60.) * (1. - smoothstep(960., 1090., P3.x + (fbm3(P3 / 90. + 3.) - 0.5) * 30.)) * smoothstep(40., 90., P3.y) * (1. - smoothstep(300., 340., P3.y));   // v2: a borda em 1090-1150 caía no começo da nuvem salmão e virava listra mauve vertical; recuada e mais larga
      c *= mix(vec3(1.), vec3(0.85, 0.82, 0.86), zC2);
    }
    if (skyDbg > 0.5) c = vec3(dH, dens, lmid / max(lglob, 1e-4) * 0.5);
    gl_FragColor = vec4(c, 1.);
  }`,
  depthWrite: false, side: THREE.BackSide,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(20000, 64, 32), skyMat);
sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

/* ---------- texturas ---------- */
const manager = new THREE.LoadingManager();
const tl = new THREE.TextureLoader(manager);
function tex(uri, repeat = true) {
  const t = tl.load(uri); t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 16; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t;
}
const T = {
  rock: tex(window.D_ROCK), rocknor: tex(window.D_ROCKNOR), rock2: tex(window.D_ROCK2), dark: tex(window.D_DARK),
  sky: tex(window.D_SKY), scree: tex(window.D_SCREE), gravel: tex(window.D_GRAVEL), stones: tex(window.D_STONES), mossy: tex(window.D_MOSSY), pitted: tex(window.D_PITTED), grass: tex(window.D_GRASS), lichen: tex(window.D_LICHEN), screenor: tex(window.D_SCREENOR), ground: tex(window.D_GROUND), snow: tex(window.D_SNOW), spruce: tex(window.D_SPRUCE, false), rockface: tex(window.D_ROCKFACE),
};
// médias sRGB medidas no empacotamento, pra normalizar o detalhe em torno de 1
/* ---------- nuvem pintada (autoria a partir do manifesto, em % do quadro) ---------- */
function buildCloudMask() {
  const cv = document.createElement('canvas'); cv.width = 720; cv.height = 400;
  const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 720, 400);
  g.globalCompositeOperation = 'lighter'; g.filter = 'blur(9px)';
  const E = (ch, x, y, rx, ry, rot, a) => {
    g.save(); g.translate((x + 40) * 4, (y + 40) * 4); g.rotate(rot * DEG); g.scale(rx * 4, ry * 4);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    const col = ch === 'r' ? [255, 0, 0] : ch === 'g' ? [0, 255, 0] : [0, 0, 255];
    gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(0.55, `rgba(${col},${a * 0.8})`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, 6.2832); g.fill(); g.restore();
  };
  // massa salmão grande da direita, subindo da esquerda pra direita
  E('r', 80, 13, 28, 9, -10, 0.9); E('r', 66, 17, 15, 6, -12, 0.85); E('r', 98, 15, 13, 9, 0, 0.8);
  E('r', 75, 21, 18, 3.5, -5, 0.9); E('r', 92, 20, 8, 4.5, 0, 0.95); E('r', 60, 8, 9, 6, 0, 0.35);   // massa salmão mais baixa, logo acima dos picos da direita
  // nuvens lilás no alto à esquerda
  E('r', 17, 4, 9, 5, 0, 0.6); E('r', 22, 10, 4, 1.2, -10, 0.7); E('r', 32, 3, 8, 3, 0, 0.45); E('r', 40, 7, 6, 2, 5, 0.35);
  // faixa laranja acesa e puff no pico da extrema direita
  E('g', 76, 17.5, 15, 2.2, -6, 1.0); E('g', 91, 20, 5, 3, 0, 1.0); E('g', 64, 21, 6, 1.8, -4, 0.6);
  // vãos mais limpos
  E('b', 50, 12, 6, 8, 0, 0.6); E('b', 30, 14, 8, 5, 0, 0.5); E('b', 68, 6, 4, 3, 0, 0.4);
  const t = new THREE.CanvasTexture(cv); t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}
skyMat.uniforms.tCloud.value = buildCloudMask();
skyMat.uniforms.tSky.value = T.sky; skyMat.uniforms.refR.value.copy(REF_BASIS[0]); skyMat.uniforms.refU.value.copy(REF_BASIS[1]); skyMat.uniforms.refF.value.copy(REF_BASIS[2]); T.sky.wrapT = THREE.ClampToEdgeWrapping;
const MEAN = { rock: [0.486, 0.324, 0.193], rock2: [0.513, 0.412, 0.315], dark: [0.129, 0.11, 0.092], scree: [0.431, 0.363, 0.205], ground: [0.5, 0.412, 0.351], snow: [0.529, 0.527, 0.579] };
const mv = k => new THREE.Vector3(...MEAN[k].map(v => Math.pow(v, 2.2)));

/* ---------- terreno ---------- */
const tU = {
  time: U.time, yaw: U.yaw, skyTex: U.skyTex, camRef: U.camRef,
  tRock: { value: T.rock }, tRockNor: { value: T.rocknor }, tRock2: { value: T.rock2 }, tDark: { value: T.dark },
  tScree: { value: T.scree }, tGround: { value: T.ground }, tSnow: { value: T.snow },
  mRock: { value: mv('rock') }, mRock2: { value: mv('rock2') }, mDark: { value: mv('dark') }, mScree: { value: mv('scree') },
  mGround: { value: mv('ground') }, mSnow: { value: mv('snow') },
  cTen: { value: lin(TUNE.tenPeaks) }, cCentral: { value: lin(TUNE.central) }, cWall: { value: lin(TUNE.leftWall) },
  cWallBand: { value: lin(TUNE.leftWallBand) }, cTalL: { value: lin(TUNE.talusLeft) }, cTalC: { value: lin(TUNE.talusCenter) },
  cSnowS: { value: lin(TUNE.snowShade) }, cSnowL: { value: lin(TUNE.snowLit) }, cFloor: { value: lin(TUNE.forestFloor) },
  cMoss: { value: lin(TUNE.moss) }, cSun: { value: lin(TUNE.sunRock) }, cSun2: { value: lin(TUNE.sunRock2) },
  haze: { value: TUNE.haze }, hazeDist: { value: TUNE.hazeDist }, strata: { value: TUNE.strata }, detail: { value: TUNE.detail },
  /* crista do pico escuro da direita (sil_trace.py, x da vista 1460 a 1790 de 10 em 10): quanto subir (px) e topo atual */
  silR: { value: [0, 0, 0, 0, 4, 10, 11, 8, 0, 0, 4, 15, 28, 45, 54, 62, 64, 60, 60, 50, 40, 40, 22, 7, 6, 7, 9, 9, 0, 0, 0, 0, 0, 0] },
  silT: { value: [327, 322, 318, 316, 322, 322, 322, 313, 299, 294, 291, 295, 304, 319, 327, 337, 343, 351, 361, 370, 375, 381, 376, 373, 373, 373, 373, 368, 353, 345, 341, 339, 339, 326] },
  /* borda direita do paredão na foto (tools/wall_edge.py), x da vista por linha y 120 a 340 de 10 em 10 */
  // borda direita do paredão (vista, y 0 a 340 de 10 em 10, tools/wall_edge.py). v2: de y 0 a 110 também (no alto ele saía 17 a
  // 39 px mais largo que a foto; ?oldborda3 volta)
  wallE: { value: (Q.has('oldborda3') ? Array(12).fill(999) : [184, 195, 212, 225, 232, 239, 256, 263, 274, 280, 289, 300])
    .concat([303, 311, 321, 326, 333, 343, 353, 362, 371, 379, 388, 395, 402, 405, 412, 418, 425, 433, 441, 453, 462, 466, 477]) },
  /* maciço da esquerda (x da vista 480 a 710 de 10 em 10) */
  silR2: { value: [0, 0, 8, 12, 17, 23, 22, 22, 23, 18, 20, 27, 29, 30, 34, 36, 24, 25, 16, 11, 12, 10, 5, 0] },
  silT2: { value: [221, 226, 234, 241, 245, 248, 248, 247, 245, 239, 237, 236, 235, 229, 222, 215, 206, 201, 188, 181, 181, 180, 176, 172] },
  dbgF: { value: Q.has('dbgf') ? 1 : 0 }, partF: { value: Q.has('nof') ? 0 : 1 }, fGain: { value: Q.has('fg') ? parseFloat(Q.get('fg')) : 1.0 },
  cF: { value: lin('#4F4140') }, cFlank: { value: lin('#614e4e') }, cFor: { value: lin('#272824') },
  partA: { value: Q.has('noa') ? 0 : 1 }, aGain: { value: Q.has('ag') ? parseFloat(Q.get('ag')) : 1.0 }, cWS: { value: lin('#281D1A') }, cWL: { value: lin('#41312B') }, cVeg: { value: lin('#1a1e14') },
  partB: { value: Q.has('nob') ? 0 : 1 }, partC: { value: Q.has('noc') ? 0 : 1 }, cLitC: { value: lin('#855F51') }, cRockE: { value: lin('#3C2F28') },
  partD: { value: Q.has('nod') ? 0 : 1 }, partE: { value: Q.has('noe') ? 0 : 1 }, tBake2: { value: null }, useBake2: { value: 0 }, partH: { value: Q.has('nocliffh') ? 0 : 1 }, partI: { value: Q.has('nofanedge') ? 0 : 1 }, partJ: { value: Q.has('noseam') ? 0 : Q.has('seamdbg') ? 2 : 1 }, partK: { value: Q.has('water85') ? 1 : 0 /* item 85 perdeu 2x (r85b 66%, r85c 58%): desligado */ }, tmA: U.tmA, tmK: U.tmK, partL: U.partL, tFloorM: { value: null }, useFloor: { value: 0 }, partN: { value: Q.has('norampa') ? 0 : 1 }, partM: { value: Q.has('margem') ? 1 : 0 } /* faixa de margem perdeu 2x (60%, 62%): desligada */, cFloorV: { value: lin('#2b2d26') } /* item 83: emenda encosta/penhasco */ /* item 78: borda do leque */ /* item 77: penhasco do Blender (Voronoi em colunas + sombra da encosta) ganhou do crítico (r77f, 62%); ?nocliffh desliga */, dbgP: { value: Q.has('dbgp') ? 1 : 0 }, cFan: { value: lin('#815E50') }, cCone: { value: lin('#a8837a') }, cSand: { value: lin('#9C7D6B') }, cGrass: { value: lin('#2C301A') },
  tRockF: { value: T.rockface }, mRockF: { value: new THREE.Vector3(...[0.38, 0.273, 0.194].map(v => Math.pow(v, 2.2))) }, cWT: { value: lin('#4F3B31') }, cWK: { value: lin('#1A1412') }, cWD: { value: lin('#2F231E') }, cVeg2: { value: lin('#2C301A') },
  oldTop: { value: [-176.3, -167.8, -166.2, -158.2, -154.3, -140.9, -138.0, -119.1, -104.9, -102.7, -99.3, -81.8, -78.3, -77.4, -75.8, -70.8, -66.6, -58.1, -45.8, -35.6, -27.1, -20.3, -1.7, 12.5, 21.7, 30.3, 37.5, 43.9, 52.9, 77.6, 92.5, 103.1, 112.4, 118.9, 124.3, 126.5, 129.3, 151.8, 154.6, 167.0, 171.5, 178.0, 189.3, 190.4, 202.9, 213.5, 221.8, 220.7, 219.1, 217.3, 210.5, 221.4, 230.5, 245.6, 255.1, 270.2, 288.6, 305.7, 322.6, 349.6, 365.9, 383.5, 401.2, 417.4, 636.4, 648.2, 656.8, 664.2, 667.6, 670.9, 674.1, 680.3, 682.2, 686.8, 690.4, 693.0, 696.6, 701.9, 706.8, 711.9, 716.9, 721.2, 725.1, 727.8, 731.0, 732.5, 733.5, 9999, 9999, 9999, 9999, 9999, 9999, 9999, 9999, 9999, 9999, 9999, 9999, 9999, 9999] },   // topo do paredão antigo no quadro, a cada 10 px (tools/part1_masks.py)
  bakeTH: { value: 1.0213860436761162 }, bakeTV: { value: 0.5612920120610185 }, bakePerPx: { value: Q.has('vbuv') ? 0 : 1 }, bakeFx: { value: Q.has('bakefx') ? 1 : 0 },   // blender/bake_uv.json
  clipY: { value: -1e9 }, tGravel: { value: T.gravel }, tStones: { value: T.stones }, tMossy: { value: T.mossy }, tGrass: { value: T.grass }, tLichen: { value: T.lichen }, tScreeNor: { value: T.screenor }, cNearTal: { value: lin('#8a7a6c') }, cNearCoarse: { value: lin('#4a4038') }, nearGain: { value: 1.0 }, refFoc: { value: 1000 / Math.tan(C.hfov * DEG / 2) }, refR: { value: REF_BASIS[0] }, refU: { value: REF_BASIS[1] }, refF: { value: REF_BASIS[2] }, tBake: { value: null }, useBake: { value: 0 }, bakeExp: { value: TUNE.bakeExp },
};
const HAZE_GLSL = `
uniform float haze, hazeDist; uniform vec3 camRef;
vec3 applyHaze(vec3 col, vec3 P){
  vec3 v = P - cameraPosition; float d = length(v);
  vec3 dir = v / d; vec3 hd = normalize(vec3(dir.x, 0.03, dir.z));
  vec3 hc = mix(skyBase(hd), vec3(0.42, 0.40, 0.50), 0.45) * 0.9;
  float f = 1. - exp(-max(d - 2500., 0.) / hazeDist);
  f *= exp(-max(P.y - 300., 0.) / 1600.);
  return mix(col, hc, clamp(f * haze, 0., 1.));
}`;
const terrainMat = new THREE.ShaderMaterial({
  uniforms: tU,
  vertexShader: `
  attribute vec4 acol; attribute vec2 buv; varying vec2 vBuv; varying vec4 vCol; varying vec2 vData; varying vec3 vP; varying vec3 vN;
  uniform vec3 camRef, refR, refU, refF; uniform float refFoc; uniform float silR[34], silT[34], silR2[24], silT2[24];
  void main(){ vBuv = vec2(buv.x, 1.0 - buv.y); vCol = acol; vData = vec2(uv.x, 1.0 - uv.y); vec4 wp = modelMatrix*vec4(position,1.);
    float dM = length(wp.xz - vec2(-160., 601.)); wp.y = mix(min(wp.y, -1.5), wp.y, smoothstep(28., 45., dM));   // ponto 4: morrinho do DEM saindo da água, afundado
    vP = wp.xyz;
    if (${Q.has('oldcrista') ? 'false' : 'true'} && length(wp.xz) > 2200.) {
      // jogo dos erros (pico escuro à esquerda do laranja): na foto ele é até ~64 px mais alto e o cume vai mais pra direita (linha
      // do céu medida coluna a coluna, tools/sil_trace.py). A malha sobe na faixa de cima (estica ~220 px de rocha) e a textura vai
      // junto, porque vP (que guia textura, zonas e névoa) fica na posição original; o reflexo vê a malha nova (?oldcrista volta)
      vec3 rdW = wp.xyz - camRef; float zfW = dot(rdW, refF);
      if (zfW > 10.) {
        float XcW = 1000. + refFoc * dot(rdW, refR) / zfW, YcW = 666.5 - refFoc * dot(rdW, refU) / zfW;
        float xvW = 1000. + (XcW - 1000.) * 0.96, yvW = 669.8 + (YcW - 666.5) * 0.96;
        float tW = (xvW - 1460.) / 10.;
        if (tW > 0. && tW < 33. && yvW < 600.) {
          int iW = int(floor(tW)); float fW = fract(tW);
          float rW = mix(silR[iW], silR[iW + 1], fW), ytW = mix(silT[iW], silT[iW + 1], fW);
          float wW = 1. - smoothstep(0., 220., yvW - ytW);
          YcW -= rW * wW / 0.96;
          wp.xyz = camRef + zfW * (refF + (XcW - 1000.) / refFoc * refR - (YcW - 666.5) / refFoc * refU);
        }
        // maciço da esquerda (jogo dos erros 16): na foto o alto é mais largo, ombro esquerdo ~25 px e topo ~36 px mais altos
        float tW2 = (xvW - 480.) / 10.;
        if (${Q.has('oldmacico2') ? 'false' : 'true'} && tW2 > 0. && tW2 < 23. && yvW < 600.) {
          int iW2 = int(floor(tW2)); float fW2 = fract(tW2);
          float rW2 = mix(silR2[iW2], silR2[iW2 + 1], fW2), ytW2 = mix(silT2[iW2], silT2[iW2 + 1], fW2);
          float wW2 = 1. - smoothstep(0., 240., yvW - ytW2);
          YcW -= rW2 * wW2 / 0.96;
          wp.xyz = camRef + zfW * (refF + (XcW - 1000.) / refFoc * refR - (YcW - 666.5) / refFoc * refU);
        }
      }
    }
    if (${!Q.has('talus2') ? 'false' : 'true'} && vData.y > 5.5) {
      // jogo dos erros 3 (pior bloco do paredão, x 280-320 y 520-560): na foto o cone de tálus da esquerda é um leque mais largo:
      // ápice ~15 px à esquerda e ~12 px acima, flanco esquerdo ~20 px à esquerda no meio e ~37 px no pé, até o encontro com a
      // encosta da frente; a borda da direita ~8 px mais baixa (medido com tools/talus_edge.py). Andam as peças do cone e a rampa
      // embaixo delas (sem a rampa o cone rasgava); a encosta da frente e o penhasco ficam. A textura vai junto porque vP fica na
      // posição original (?oldtalus2 volta)
      vec3 rdT = wp.xyz - camRef; float zfT = dot(rdT, refF);
      if (zfT > 10.) {
        float XcT = 1000. + refFoc * dot(rdT, refR) / zfT, YcT = 666.5 - refFoc * dot(rdT, refU) / zfT;
        float xvT = 1000. + (XcT - 1000.) * 0.96, yvT = 669.8 + (YcT - 666.5) * 0.96;
        if (xvT > 140. && xvT < 620. && yvT > 470. && yvT < 840.) {
          float Ls = xvT < 188. ? mix(611., 653., (xvT - 100.) / 88.) : (xvT < 223. ? mix(653., 660., (xvT - 188.) / 35.) : 660. + (xvT - 223.) * 0.9);
          float wL = smoothstep(0., 14., Ls - yvT);
          float dxT = -(15. + 22. * smoothstep(570., 650., yvT)) * (1. - smoothstep(340., 470., xvT)) * (1. - smoothstep(690., 840., yvT)) * wL
                    - 14. * (1. - smoothstep(300., 345., xvT)) * (1. - smoothstep(530., 575., yvT)) * wL;   // v2: ápice da foto em ~(290, 510)
          float eO = 559. + (xvT - 380.) * 0.58;
          float dyT = -12. * (1. - smoothstep(300., 400., xvT)) * (1. - smoothstep(0., 90., yvT - 528.)) * wL
                    - 10. * smoothstep(310., 335., xvT) * (1. - smoothstep(365., 400., xvT)) * (1. - smoothstep(0., 60., yvT - (524. + (xvT - 320.) * 0.6))) * wL   // ombro da direita mais alto
                    + 7. * smoothstep(420., 470., xvT) * (1. - smoothstep(540., 600., xvT)) * (1. - smoothstep(0., 70., yvT - eO));
          float wT = clamp((abs(dxT) + abs(dyT)) / 20., 0., 1.);
          XcT += dxT / 0.96; YcT += dyT / 0.96;
          wp.xyz = camRef + zfT * (1. - 0.002 * wT) * (refF + (XcT - 1000.) / refFoc * refR - (YcT - 666.5) / refFoc * refU);
        }
      }
    }
    vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*wp; }`,
  fragmentShader: GLSL_COMMON + HAZE_GLSL + `
  uniform sampler2D tRock, tRockNor, tRock2, tDark, tScree, tGround, tSnow;
  // carregamento (pedido: "demora pra abrir"): o fbm3 analítico chamado ~160 vezes neste shader levava ~36 s de compilação no D3D.
  // Aqui ele vira uma leitura do ruído pré-calculado no canal alfa do tDark (mesmo ruído de valor em 3 oitavas, período de 64 unidades).
  // ?oldnoise volta ao analítico
  ${Q.has('oldnoise') ? '' : 'float fbmT(vec2 p){ return textureLod(tDark, p * 0.015625, 0.).a; }\n#define fbm3(p) fbmT(p)'}
  uniform vec3 mRock, mRock2, mDark, mScree, mGround, mSnow;
  uniform vec3 cTen, cCentral, cWall, cWallBand, cTalL, cTalC, cSnowS, cSnowL, cFloor, cMoss, cSun, cSun2;
  uniform float strata, detail, clipY;
  uniform sampler2D tBake, tGravel, tStones, tMossy, tGrass, tScreeNor; uniform vec3 cNearTal, cNearCoarse; uniform float nearGain;
  vec3 triNs(sampler2D t, vec3 P, vec3 N, vec3 w, float s){ vec3 nx = texture2D(t, P.zy*s).xyz*2.-1., ny = texture2D(t, P.xz*s).xyz*2.-1., nz = texture2D(t, P.xy*s).xyz*2.-1.;
    return normalize(N + (vec3(0., nx.y, nx.x)*w.x + vec3(ny.x, 0., ny.y)*w.y + vec3(nz.x, nz.y, 0.)*w.z) * 0.9); } uniform float useBake, bakeExp, refFoc, bakeTH, bakeTV, bakePerPx, bakeFx, dbgF, partF, fGain, partA, aGain, partB, partC, partD, dbgP, partE, useBake2, partH, partI, partJ, partK, tmA, tmK, partL, useFloor, partM, partN; uniform sampler2D tBake2, tFloorM; uniform vec3 cFloorV; uniform float silR[34], silT[34], wallE[35];
  // passo 1 (progresso): inversa do pós da página pros pixels que mostram a imagem do Blender direto (ACES + sRGB, ou o antigo)
  vec3 srgbInv(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
  vec3 acesInv(vec3 y){ vec3 a = 2.51 - 2.43 * y; vec3 b = 0.03 - 0.59 * y; return (-b + sqrt(max(b * b + 0.56 * a * y, 0.))) / (2. * a); }
  vec3 invPost(vec3 D){ if (tmA > 1.5) { vec3 q = srgbInv(min(D, vec3(0.995))); return mix(q, 0.6 - 0.4 * log((1. - q) / 0.4), step(0.6, q)); }
    if (tmA > 0.5) return acesInv(srgbInv(min(D, vec3(0.985)))) / tmK; vec3 s = pow(min(D, vec3(0.995)), vec3(2.2)); return mix(s, 0.6 - 0.4 * log((1. - s) / 0.4), step(0.6, s)); } uniform vec3 refR, refU, refF, cF, cFlank, cFor, cWS, cWL, cVeg, cWT, cWK, cWD, cVeg2, cLitC, cRockE, mRockF, cFan, cSand, cGrass, cCone;  uniform float oldTop[101]; varying vec2 vBuv;
  vec3 triB(sampler2D t, vec3 P, vec3 w, float s){ return toLin(texture2D(t, P.zy*s, 6.).rgb)*w.x + toLin(texture2D(t, P.xz*s, 6.).rgb)*w.y + toLin(texture2D(t, P.xy*s, 6.).rgb)*w.z; }
  varying vec4 vCol; varying vec2 vData; varying vec3 vP; varying vec3 vN;
  vec3 tri(sampler2D t, vec3 P, vec3 w, float s){
    ${Q.has('ct_tri') ? 'return toLin(textureLod(t, P.zy*s, 0.).rgb)*w.x + toLin(textureLod(t, P.xz*s, 0.).rgb)*w.y + toLin(textureLod(t, P.xy*s, 0.).rgb)*w.z;' : ''}
    return toLin(texture2D(t, P.zy*s).rgb)*w.x + toLin(texture2D(t, P.xz*s).rgb)*w.y + toLin(texture2D(t, P.xy*s).rgb)*w.z; }
  vec3 triN(vec3 P, vec3 N, vec3 w, float s){
    vec3 nx = texture2D(tRockNor, P.zy*s).xyz*2.-1., ny = texture2D(tRockNor, P.xz*s).xyz*2.-1., nz = texture2D(tRockNor, P.xy*s).xyz*2.-1.;
    vec3 n = vec3(0., nx.y, nx.x)*w.x + vec3(ny.x, 0., ny.y)*w.y + vec3(nz.x, nz.y, 0.)*w.z;
    return normalize(N + n * 1.2); }
  // pedras soltas (parte 4b): células de cs m com pedra de raio sorteado, clara ou escura, e sombra deslocada (sh) pro lado
  // oposto à luz. Volta (máscara da pedra, brilho da pedra, sombra no chão)
  vec3 stoneF(vec2 q, float cs, float rmin, float rmax, vec2 sh, float dens){
    ${Q.has('ct_stone') ? 'return vec3(0., 1., 0.) + 0. * q.x;' : ''}
    vec2 ci = floor(q / cs); float best = 0., bri = 1., shd = 0.;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
      vec2 c = ci + vec2(float(i), float(j));
      vec2 h = fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453);
      float h3 = fract(sin(dot(c, vec2(41.3, 289.1))) * 15731.743);
      if (h3 > dens) continue;
      vec2 p = (c + 0.15 + 0.7 * h) * cs;
      float rr = mix(rmin, rmax, h.x * h.y);
      float m = 1. - smoothstep(rr * 0.6, rr, length(q - p));
      float s = 1. - smoothstep(rr * 0.7, rr * 1.2, length(q - p - sh * rr));
      if (m > best) { best = m; bri = mix(0.5, 1.6, fract(h3 * 7.31)); }
      shd = max(shd, s);
    }
    return vec3(best, bri, shd);
  }
  // sopé da direita: mancha de neve = cápsula afinando do topo (a) pra base (b), em px do quadro
  // cunha: ponta em a, base centrada em b com meia largura hw (perfil pow pw); volta distância aproximada em px (< 0 dentro)
  float sideS = 0.;   // lado da cunha mais próxima: -1 esquerda (luz), +1 direita (sombra)
  float capS(vec2 p, vec2 a, vec2 b, float pw, float hw){ float L = b.y - a.y; float t = (p.y - a.y) / L; float cx = mix(a.x, b.x, t); float w = hw * pow(clamp(t, 0., 1.), pw); float d = max(abs(p.x - cx) - w, max(-t * L, (t - 1.) * L)); if (d < 2.) sideS = clamp((p.x - cx) / max(w, 1.), -1., 1.); return d; }
  void main(){
    if (vP.y < clipY) discard;
    if (useBake > 0.5) {
      // projeção da CAM_FOTO calculada por pixel (exata, sem interpolação afim do UV por vértice)
      vec3 rdp = vP - camRef; float zfp = max(dot(rdp, refF), 1.);
      vec2 buvP = vec2(0.5 + dot(rdp, refR) / zfp / (2. * bakeTH), 0.5 + dot(rdp, refU) / zfp / (2. * bakeTV));
      vec2 buvS = bakePerPx > 0.5 ? clamp(buvP, 0.0005, 0.9995) : vBuv;
      vec3 e = pow(texture2D(tBake, buvS).rgb, vec3(2.2));
      vec3 bc = 0.5 * e / max(1. - e, 1e-3) * bakeExp * vec3(1.1, 0.98, 0.84);
      // item 72: montanhas do fundo = imagem que sai do Blender direto (render Cycles pela CAM_FOTO, transformação AgX da tela
      // do Blender). Desfaz o pós da página (ombro + gama 2,2) pra o pixel final ser o do Blender; sem tinta, textura nem neve
      // desenhada. Paredão, penhasco e cascalho continuam com os blocos próprios mais abaixo (passam por cima disto).
      vec3 snowCol = vec3(0.); float snowW = 0.;   // neve do bake (tom já medido na foto por zona): protegida dos ganhos de zona da rocha
      if (useBake2 > 0.5 && length(vP.xz) > 2150.) {                 // só atrás do paredão da esquerda: o perto (paredão, penhasco, cascalho) fica como estava
        vec3 Dm = min(texture2D(tBake2, buvS, -0.7).rgb, vec3(0.995));
        bc = invPost(Dm);
        float mxD = max(Dm.r, max(Dm.g, Dm.b)), stD = (mxD - min(Dm.r, min(Dm.g, Dm.b))) / max(mxD, 1e-4);
        snowCol = bc; snowW = smoothstep(0.58, 0.66, dot(Dm, vec3(0.2126, 0.7152, 0.0722))) * smoothstep(0.26, 0.18, stD);
      }
      if (${Q.has('oldsilhueta') ? 'false' : 'true'} && length(vP.xz) > 2150.) {
        // jogo dos erros 14, 21, 22: o pico do meio saía um espinho ~27 px mais alto e estreito, o vizinho com duas pontas ~10 px
        // mais alto e o pico laranja pequeno da esquerda ~13 px mais alto. Linha do céu medida na foto (vista -> CAM_FOTO); acima
        // dela a montanha some e aparece o céu (o reflexo acompanha, porque o recorte é pela posição no mundo) (?oldsilhueta volta)
        vec3 rdS = vP - camRef; float zfS = max(dot(rdS, refF), 1.);
        float XS = 1000. + refFoc * dot(rdS, refR) / zfS, YS = 666.5 - refFoc * dot(rdS, refU) / zfS;
        float yS = -1e4;   // fora dos trechos medidos não corta nada
        if (XS > 1052. && XS < 1328.) {   // pontos da foto convertidos da vista pro quadro da CAM_FOTO
          yS = XS < 1073. ? mix(356., 328., (XS - 1052.) / 21.) : (XS < 1088. ? mix(328., 315., (XS - 1073.) / 15.) : (XS < 1104. ? mix(315., 310., (XS - 1088.) / 16.) :
               (XS < 1120. ? mix(310., 309., (XS - 1104.) / 16.) : (XS < 1137. ? mix(309., 312., (XS - 1120.) / 17.) : (XS < 1156. ? mix(312., 320., (XS - 1137.) / 19.) :
               (XS < 1177. ? mix(320., 341., (XS - 1156.) / 21.) : (XS < 1193. ? mix(341., 359., (XS - 1177.) / 16.) : (XS < 1208. ? mix(359., 354., (XS - 1193.) / 15.) :
               (XS < 1224. ? mix(354., 335., (XS - 1208.) / 16.) : (XS < 1240. ? mix(335., 320., (XS - 1224.) / 16.) : (XS < 1255. ? mix(320., 310., (XS - 1240.) / 15.) :
               (XS < 1266. ? mix(310., 312., (XS - 1255.) / 11.) : (XS < 1281. ? mix(312., 328., (XS - 1266.) / 15.) : (XS < 1297. ? mix(328., 346., (XS - 1281.) / 16.) :
               (XS < 1312. ? mix(346., 356., (XS - 1297.) / 15.) : mix(356., 359., (XS - 1312.) / 16.))))))))))))))));
        }
        if (XS > 375. && XS < 552.) {   // v2: até 552 (sobrava um toco laranja à direita do pico)
          yS = XS < 388. ? mix(245., 240., (XS - 375.) / 13.) : (XS < 406. ? mix(240., 219., (XS - 388.) / 18.) : (XS < 422. ? mix(219., 207., (XS - 406.) / 16.) :
               (XS < 438. ? mix(207., 202., (XS - 422.) / 16.) : (XS < 453. ? mix(202., 201., (XS - 438.) / 15.) : (XS < 469. ? mix(201., 207., (XS - 453.) / 16.) :
               (XS < 484. ? mix(207., 219., (XS - 469.) / 15.) : (XS < 495. ? mix(219., 227., (XS - 484.) / 11.) : (XS < 511. ? mix(227., 230., (XS - 495.) / 16.) : mix(230., 228., (XS - 511.) / 41.)))))))));
          yS += (fbm3(vec2(XS / 5., 7.7)) - 0.5) * 9. * smoothstep(500., 515., XS);   // topo da rocha irregular (a reta lia como corte)
        }
        if (${Q.has('oldmacico2') ? 'false' : 'true'} && XS > 734. && XS < 802.) {   // flanco direito do maciço: na foto desce antes (até ~38 px)
          yS = XS < 740. ? mix(168., 183., (XS - 734.) / 6.) : (XS < 750. ? mix(183., 212., (XS - 740.) / 10.) : (XS < 760. ? mix(212., 218., (XS - 750.) / 10.) :
               (XS < 771. ? mix(218., 224., (XS - 760.) / 11.) : (XS < 781. ? mix(224., 238., (XS - 771.) / 10.) : (XS < 792. ? mix(238., 257., (XS - 781.) / 11.) : mix(257., 262., (XS - 792.) / 10.))))));
          yS += (fbm3(vec2(XS / 4., 3.3)) - 0.5) * 8.;
        }
        if (YS < yS + (fbm3(vec2(XS / 3., YS / 3.)) - 0.5) * 2.) discard;
        float tpS = smoothstep(1215., 1235., XS) * (1. - smoothstep(1295., 1315., XS)) * (1. - smoothstep(322., 356., YS));
        bc *= mix(vec3(1.), vec3(1.55, 1.12, 0.92), tpS);   // topo do pico do meio aceso e quente como na foto (era cinza escuro)
      }
      // região perto da câmera (talus e margem da esquerda, < ~820 m): texturas em resolução cheia, sem o bake por cima
      vec3 rd0 = vP - camRef; float zf0 = max(dot(rd0, refF), 1.);
      vec2 fq0 = vec2(0.5 + refFoc * dot(rd0, refR) / zf0 / 2000., 0.5 - refFoc * dot(rd0, refU) / zf0 / 1333.);
      float dN = length(vP - cameraPosition);
      float talW = smoothstep(0.2, 0.55, vCol.a);
      // divisa encosta grossa | cone: (14%,39%) -> (9,2%,49,4%) -> (21,4%,57,5%), borda quebrada
      float xb = fq0.y < 0.494 ? 0.14 + (fq0.y - 0.39) * (-0.048 / 0.104) : 0.092 + (fq0.y - 0.494) * (0.122 / 0.081);
      float wig = (fbm3(vP.xz / 18.) - 0.5) * 0.012;
      float coarse = smoothstep(0.004, -0.004, fq0.x - xb + wig) * step(0.36, fq0.y);
      float nearW = (1. - smoothstep(600., 800., dN)) * (1. - smoothstep(0.30, 0.50, fq0.x + (fbm3(vP.xz / 60.) - 0.5) * 0.06)) * max(talW, coarse);   // defeito 3: transição gradual (200 m), sem corte reto no quadro
      if (nearW > 0.001) {
        vec3 Nn = normalize(vN); vec3 wn = pow(abs(Nn), vec3(4.)); wn /= (wn.x + wn.y + wn.z);
        float bigN = smoothstep(0.35, 0.65, fbm3(vP.xz / 160.));
        // cone: aerial_rocks_02 + aerial_ground_rock meio a meio (tile 25 m), cor real com ~25% puxando pra #8a7a6c
        vec3 cone = mix(tri(tScree, vP, wn, 1./25.), tri(tGround, vP, wn, 1./25.), bigN);
        cone = mix(cone, mix(tri(tScree, vP + 37., wn, 1./63.), tri(tGround, vP + 11., wn, 1./63.), 1. - bigN), 0.5);   // duas escalas: sem repetição de tile
        cone = mix(cone, cNearTal * (dot(cone, vec3(0.333)) / 0.12), 0.25);
        float cm = max(dot(cone, vec3(0.333)), 1e-3); cone = cone / cm * 0.12 * pow(cm / 0.12, 0.5);   // cascalho fino de longe: contraste do grão pela metade, sem grade de pedra
        cone *= mix(0.85, 1.12, smoothstep(10., 110., vP.y));
        vec2 dsl = normalize(Nn.xz + vec2(1e-4)); vec2 dpp = vec2(-dsl.y, dsl.x);
        float stk = fbm3(vec2(dot(vP.xz, dpp) / 5., dot(vP.xz, dsl) / 80.));
        cone *= 0.9 + 0.2 * stk;
        // mancha verde no alto do cone, lado esquerdo: mossy_rock no miolo, aerial_grass_rock na borda
        float pm = 1. - length((fq0 - vec2(0.135, 0.49)) / vec2(0.032, 0.036)) + (fbm3(vP.xz / 14.) - 0.5) * 0.9;
        float clump = smoothstep(0.45, 0.62, fbm3(vP.xz / 3.5));                     // tufos picotados, não halo redondo
        vec3 grn = tri(tGrass, vP, wn, 1./25.) * vec3(0.75, 1.0, 0.55);
        cone = mix(cone, grn, clamp(smoothstep(-0.1, 0.25, pm) * clump * 1.2, 0., 0.9));
        cone = mix(cone, mix(grn, tri(tMossy, vP, wn, 1./25.), 0.4), smoothstep(0.35, 0.6, pm) * clump);
        // encosta de pedra grossa: rocky_gravel (8 m) puxando pra #4a4038, lichen_rock ~20% nas partes baixas
        vec3 crs = mix(tri(tGravel, vP, wn, 1./14.), tri(tGravel, vP.zyx + 13., wn.zyx, 1./21.), 0.4);   // região 8: blocos maiores, duas escalas
        crs = mix(crs, cNearCoarse * (dot(crs, vec3(0.333)) / 0.12), 0.25);
        crs = mix(crs, vec3(dot(crs, vec3(0.299, 0.587, 0.114))), 0.35) * 0.48;            // entulho grosso: blocos escuros (região 8)
        float lch = smoothstep(0.55, 0.7, fbm3(vP.xz / 30.)) * (1. - smoothstep(10., 45., vP.y));
        crs = mix(crs, tri(tMossy, vP, wn, 1./8.) * 0.8, lch * 0.6);   // item 72: tLichen saiu (limite de 16 texturas; área coberta pela peça E)
        float band = (1. - smoothstep(0.0, 0.009, abs(fq0.x - xb + wig))) * step(0.42, fq0.y);
        vec3 alb = mix(cone, crs, coarse);
        alb = mix(alb, tri(tGrass, vP, wn, 1./12.) * vec3(0.55, 0.7, 0.45), band * 0.0);   // faixa de capim desligada: lia como risco desenhado
        // linha d'água: gravel_stones (2,5 m), escura e molhada numa faixa de 1 a 3 m
        alb = mix(alb, tri(tStones, vP, wn, 1./2.5) * 0.45, 1. - smoothstep(0.4, 2.6, vP.y));
        // luz: céu difuso + chave suave do céu claro, oclusão assada, normal map triplanar
        vec3 nA = triNs(tScreeNor, vP, Nn, wn, 1./25.);
        vec3 keyd = normalize(vec3(0.55, 0.42, -0.72));
        float sh = (0.55 + 0.45 * nA.y) * mix(0.55, 1.05, vCol.g) + 0.55 * max(dot(nA, keyd), 0.);
        // brilho vem da luz assada do Cycles (luminância do bake); cor e grão vêm das texturas cheias -> sem emenda de luz
        float lbake = dot(bc, vec3(0.2126, 0.7152, 0.0722));
        float lalb = dot(alb, vec3(0.2126, 0.7152, 0.0722));
        // mesma cor média dos dois lados: o brilho local vem do bake, a textura cheia entra como detalhe sobre a própria média (mip alto)
        vec3 coneB = mix(triB(tScree, vP, wn, 1./25.), triB(tGround, vP, wn, 1./25.), bigN);
        vec3 crsB = triB(tGravel, vP, wn, 1./14.); crsB = mix(crsB, vec3(dot(crsB, vec3(0.299, 0.587, 0.114))), 0.35) * 0.48;
        float lB = max(dot(mix(coneB, crsB, coarse), vec3(0.2126, 0.7152, 0.0722)), 0.02);
        vec3 nearC = alb / lB * lbake * (0.75 + 0.25 * sh) * nearGain;
        bc = mix(bc, nearC, nearW);
      }
      float Xf = fq0.x * 2000., Yf = fq0.y * 1333., Rh = length(vP.xz);
      // jogo dos erros 29: no canto direito o morro de perto (margem da direita) subia acima da mata como uma forma clara azulada; na
      // foto ali já é a face escura da montanha com riscos de neve e a mata termina em ~548 (vista). O morro some acima dessa linha
      if (${Q.has('oldborda2') ? 'false' : 'true'} && Rh < 2150.) {
        // jogo dos erros 12: a borda do paredão contra o céu e o pico laranja pequeno ficava 10 a 20 px à direita da foto em toda a
        // altura (medida linha a linha com tools/wall_edge.py). O paredão some à direita da linha da foto, com borda irregular
        float xvB = 1000. + (Xf - 1000.) * 0.96, yvB = 669.8 + (Yf - 666.5) * 0.96, tB = yvB / 10.;
        if (tB > -2. && tB < 34.) { tB = max(tB, 0.); int iB = int(floor(tB)); float eB = mix(wallE[iB], wallE[iB + 1], fract(tB));
          if (xvB > eB + 2. + (fbm3(vec2(Xf / 4., Yf / 4.)) - 0.5) * 6. + (fbm3(vec2(Yf / 9., 2.2)) - 0.5) * 6.) discard; }
      }
      if (${Q.has('oldmorro') ? 'false' : 'true'} && Rh < 2200. && Xf > 1945. && Yf < 548. + (fbm3(vec2(Xf / 7., 3.1)) - 0.5) * 8.) discard;
      // vegetação (pedido): chão verde escuro embaixo da floresta longe, pela máscara de onde há árvore no quadro (sem buraco claro)
      if (useFloor > 0.5 && Rh > 1100.) { vec4 fm4 = texture2D(tFloorM, vec2(Xf / 2000., 1. - Yf / 1333.)); float dT = fm4.g * 8000.; float dC = length(vP.xz - camRef.xz); float fmk = smoothstep(0.3, 0.8, fm4.a + ${Q.has('oldbeira2') ? '0.' : '(fbm3(vP.xz / 3.5) - 0.5) * 0.55 + (fbm3(vP.xz / 1.2 + 2.) - 0.5) * 0.2'}) * 0.82 * (1. - smoothstep(250., 600., abs(dC - dT)));   /* revisão: a máscara é de baixa resolução e a borda dela virava degraus cinza na margem da direita; ruído no limiar quebra os blocos */ float lnS = Xf < 1450. ? mix(650., 632., (Xf - 1250.) / 200.) : Xf < 1620. ? mix(632., 626., (Xf - 1450.) / 170.) : Xf < 1700. ? mix(626., 600., (Xf - 1620.) / 80.) : Xf < 1760. ? mix(600., 588., (Xf - 1700.) / 60.) : Xf < 1860. ? mix(588., 568., (Xf - 1760.) / 100.) : mix(568., 548., (Xf - 1860.) / 150.); fmk *= 1. - step(1250., Xf) * smoothstep(lnS + 4., lnS - 6., Yf);   /* sopé da direita: acima da linha da mata da foto o chão não fica verde */ bc = mix(bc, cFloorV * (0.8 + 0.4 * fbm3(vP.xz / 18.)), clamp(fmk, 0., 1.) * 0.92); }
      // margem da mata da direita (pedido): faixa irregular de pedra clara, tronco e capim cinza esverdeado junto da água
      if (partM > 0.5 && Xf > 1150. && Yf > 730. && Yf < 900.) {
        float gateM = smoothstep(0.38, 0.62, fbm3(vP.xz / 16.));                                   // faixa interrompida: em vários pontos a mata chega na água
        float shM = (1. - smoothstep(0.2, 0.7 + 0.9 * fbm3(vP.xz / 7.), vP.y)) * gateM;
        if (shM > 0.001) {
          vec2 shvM = -normalize(vec2(0.55, -0.72)); vec3 stM = stoneF(vP.xz, 2.6, 0.3, 1.0, shvM, 0.45);
          vec3 grM = vec3(0.055, 0.07, 0.045) * (0.7 + 0.6 * fbm3(vP.xz / 2.5));                      // vegetação baixa verde
          vec3 rkM = vec3(0.47, 0.44, 0.39) * (0.85 + 0.3 * fbm3(vP.xz / 1.5));                     // pedra e tronco claros, soltos
          float logs = smoothstep(0.7, 0.78, fbm3(vec2(vP.x / 9., vP.z / 1.2))) * smoothstep(0.4, 0.6, fbm3(vP.xz / 30.));
          float pal = clamp(stM.x * 0.9 + logs, 0., 1.);
          vec3 scM = mix(grM, rkM, pal); scM *= mix(1., 0.6, stM.z * (1. - stM.x));
          bc = mix(bc, scM, shM);
        }
      }
      // lado esquerdo (pedido): o terreno claro à direita do leque, embaixo do bosque da ponta do penhasco, vira chão escuro de mata
      if (partN > 0.5 && Xf > 540. && Xf < 790. && Yf > 615. && Yf < 776. && (vData.y < 3.5 || vData.y > 6.5)) {
        float nB = fbm3(vP.xz / 9.); float zB2 = smoothstep(540., 600., Xf + (nB - 0.5) * 50.) * (1. - smoothstep(740., 790., Xf + (nB - 0.5) * 40.));
        bc = mix(bc, cFloorV * (0.75 + 0.5 * fbm3(vP.xz / 5.)), zB2 * 0.9);
        float tal = smoothstep(718., 732., Yf + (nB - 0.5) * 10.) * (1. - smoothstep(740., 770., Xf + (nB - 0.5) * 30.)) * smoothstep(600., 640., Xf);
        bc = mix(bc, vec3(0.085, 0.06, 0.052) * (0.7 + 0.6 * fbm3(vP.xz / 2.)), tal * 0.9);   // faixa de cascalho cinza amarronzado junto da água (foto #4F403C)
      }
      if (dbgF > 0.5) { gl_FragColor = vec4(Rh < 2200. ? vec3(1., 0., 0.) : Rh < 3000. ? vec3(0., 1., 0.) : Rh < 5000. ? vec3(0., 0., 1.) : vec3(1.), 1.) * (0.4 + 0.6 * clamp(vP.y / 1500., 0., 1.)); return; }
      // parte 1 (zonas G e F): o paredão foi cortado na malha pela diagonal G; atrás dele aparece a montanha do meio.
      // Ali o bake ainda guarda a cor do paredão (renderizado antes do corte), então a rocha é feita aqui com as texturas
      // escaneadas (cliff_side + rock_face_03) e a luz pela normal da malha; à direita, onde o bake vale, só o tom vira cinza.
      if (partF > 0.5 && useBake2 < 0.5) {   // item 72: com o render novo a montanha do meio vem do Blender, sem tom nem rocha por cima
        float behind = smoothstep(2150., 2260., Rh);
        float nq = fbm3(vP.xz / 140.) - 0.5;
        // o bake só não vale onde o paredão antigo tapava a vista (abaixo do topo antigo dele, à esquerda da emenda de x~615)
        float ti = clamp(Xf / 10., 0., 99.99); int i0 = int(floor(ti));
        float oTop = min(mix(oldTop[i0], oldTop[i0 + 1], fract(ti)), 225.);
        float invalid = behind * smoothstep(oTop - 1., oTop + 5., Yf) * (1. - smoothstep(600., 680., Xf + nq * 90.));
        float fZone = behind * (1. - smoothstep(3000., 3300., Rh)) * smoothstep(330., 430., Yf + nq * 60.) * (1. - smoothstep(760., 860., Xf + nq * 120.));
        if (invalid + fZone > 0.001) {
          vec3 Nf = normalize(vN); vec3 wf = pow(abs(Nf), vec3(4.)); wf /= (wf.x + wf.y + wf.z);
          float mixF = smoothstep(0.35, 0.65, fbm3(vP.xz / 420.));
          vec3 aF = mix(tri(tRock, vP, wf, 1. / 95.) / mRock, tri(tRock2, vP + 71., wf, 1. / 130.) / mRock2, mixF);
          aF = mix(aF, tri(tDark, vP + 23., wf, 1. / 60.) / mDark, 0.3 * smoothstep(0.5, 0.7, fbm3(vP.xz / 70.)));
          vec3 keyF = normalize(vec3(0.55, 0.42, -0.72));
          float shF = (0.62 + 0.38 * Nf.y) * 0.85 + 0.3 * max(dot(Nf, keyF), 0.);
          float dF = pow(max(dot(aF, vec3(0.2126, 0.7152, 0.0722)), 0.), 1.15);
          float up = 1. - smoothstep(300., 430., Yf);                                   // flanco do maciço (mais claro e malva) em cima, cinza #4F4140 embaixo
          vec3 tgt = mix(cF, cFlank, up) * fGain;
          vec3 synth = tgt * dF * shF / 0.78;
          float lb = max(dot(bc, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
          vec3 grey = tgt * clamp(lb / max(dot(tgt, vec3(0.2126, 0.7152, 0.0722)) * 1.35, 1e-4), 0.35, 2.2);   // bake válido: guarda o claro e escuro, troca o tom
          vec3 fc = mix(mix(bc, grey, fZone * 0.85), synth, invalid);
          // floresta escura #272824 subindo da base da montanha do meio, topo recortado
          float fr = smoothstep(530., 575., Yf + (fbm3(vP.xz / 45.) - 0.5) * 70.) * behind * (1. - smoothstep(-20., 30., Xf - (830. + (Yf - 560.) * 0.7) + nq * 80.));
          vec3 can = cFor * (0.6 + 0.8 * fbm3(vP.xz / 7.)) * (0.75 + 0.35 * Nf.y);
          fc = mix(fc, can, fr * 0.9);
          bc = fc;
        }
      }
      // parte 2 (zonas A e B): paredão com camadas em relevo de verdade na malha (tools/part2_disp.py). O bake é de antes do
      // relevo, então aqui a luz vem da normal da malha deslocada (céu de cima, quina clara, recuo escuro pela oclusão por
      // vértice) e a cor fica entre #281D1A (sombra) e #41312B (luz), com o detalhe do cliff_side/rock_face no mesmo mapeamento.
      float fRamp = step(6., vData.y) * (1. - step(8., vData.y)) * partC;   // parte 3: rampa abaixo do pé (fica por baixo das peças)
      if (${Q.has('datadbg') ? 'true' : 'false'}) { gl_FragColor = vec4(vData.y / 12., fRamp, step(8., vData.y), 1.); return; }
      if (${Q.has('dbgcola') ? 'true' : 'false'}) { gl_FragColor = vec4(vCol.a, step(7.5, vData.y), 0., 1.); return; }
      float wW = clamp(vData.y - 2., 0., 1.) * partA * (1. - step(6., vData.y));
      if (wW > 0.001) {
        vec3 Nw = normalize(vN);
        float occ = clamp(vData.x - 2., 0., 1.);
        float det = clamp(vCol.b * 2., 0.4, 1.8);
        // passo 4 (pedido): a linha reta do canto de cima à esquerda é um vinco antigo gravado na oclusão/detalhe da malha;
        // numa faixa estreita em volta dela (no quadro), oclusão e detalhe viram os do entorno e a normal perde o vinco
        if (partL > 0.5) {
          vec2 lA = vec2(100., -20.), lB = vec2(252., 410.), lD = lB - lA; vec2 q = vec2(Xf, Yf) - lA;
          float dL = length(q - lD * clamp(dot(q, lD) / dot(lD, lD), 0., 1.));
          float kL = 1. - smoothstep(5., 16., dL + (fbm3(vP.xz / 9.) - 0.5) * 6.);
          occ = mix(occ, 0.8, kL); det = mix(det, 1.0, kL);
          Nw = normalize(mix(Nw, normalize(vec3(Nw.x, 0.25, Nw.z)), kL * 0.6));
        }
        vec3 wq = pow(abs(Nw), vec3(4.)); wq /= (wq.x + wq.y + wq.z);
        float fine = clamp(dot(tri(tRock, vP + 13., wq, 1. / 11.) / mRock, vec3(0.2126, 0.7152, 0.0722)), 0.5, 1.6);
        vec3 keyW = normalize(vec3(0.55, 0.42, -0.72));
        float upW = clamp(0.5 + 0.65 * Nw.y, 0., 1.);
        vec3 rockW;
        if (partB > 0.5) {
          // parte 2b: contraste dobrado pela normal e oclusão: topo do degrau até #4F3B31, face de baixo e fenda até #1A1412;
          // parte escura (Col.g) com base #2F231E; marrom quente sem roxo (R > G > B garantido no fim)
          float dkW = clamp(vCol.g, 0., 1.);
          float sB = (0.12 + 0.88 * pow(upW, 1.6)) * mix(0.05, 1.0, occ) + 0.12 * max(dot(Nw, keyW), 0.) + 0.55 * smoothstep(0.45, 0.8, Nw.y) * occ;
          vec3 cMid = mix(cWL, cWD, dkW);
          vec3 cHi = mix(cWT, cWD * 1.35, dkW * 0.6);
          rockW = sB < 0.45 ? mix(cWK, cMid, smoothstep(0.0, 0.45, sB)) : mix(cMid, cHi, smoothstep(0.45, 1.0, sB));
          rockW *= pow(det, 0.7) * pow(fine, 0.5) * aGain;
          rockW.g = min(rockW.g, rockW.r * 0.86); rockW.b = min(rockW.b, rockW.g * 0.92);
        } else {
        float sW = (0.15 + 0.85 * pow(upW, 1.4)) * mix(0.22, 1.0, occ) + 0.2 * max(dot(Nw, keyW), 0.) + 0.45 * smoothstep(0.6, 0.9, Nw.y) * occ;   // quina de camada pegando céu
        rockW = mix(cWS, cWL, clamp(sW, 0., 1.3)) * pow(det, 0.8) * pow(fine, 0.6) * aGain;
        // luz regional medida na foto: massa da esquerda bem mais escura, contraforte da borda G um pouco mais claro
        float regW = mix(0.45, 1.0, smoothstep(90., 240., Xf + (fbm3(vP.xz / 90.) - 0.5) * 60.)) * mix(1., 1.25, smoothstep(250., 380., Xf) * smoothstep(180., 300., Yf));
        float xGs = Yf < 238. ? 188. + Yf * 0.9 : 402. + (Yf - 238.) * 0.72;          // contorno da foto (aprox.)
        regW *= mix(1., 1.3, smoothstep(-120., -35., Xf - xGs));                          // rocha mais clara perto da borda, atrás da franja escura
        rockW *= regW;
        }
        float kJ = 0.;
        if (partJ > 0.5 && vData.y < 3.5) {
          // item 83: emenda encosta de cima / penhasco: a base da encosta (até ~40 px acima do topo do penhasco no quadro)
          // ganha as camadas e o tom do penhasco, misturando aos poucos, pra ler como uma massa só de rocha em camadas
          float tJ = Xf < 160. ? mix(293., 366., Xf / 160.) : Xf < 280. ? mix(366., 422., (Xf - 160.) / 120.) : Xf < 400. ? mix(422., 462., (Xf - 280.) / 120.)
                   : Xf < 520. ? mix(462., 498., (Xf - 400.) / 120.) : mix(498., 543., clamp((Xf - 520.) / 80., 0., 1.));
          float latJ = atan(-vP.z, vP.x) * 1300.;
          float dJ = tJ - Yf + (fbm3(vec2(latJ / 40., vP.y / 30.)) - 0.5) * 18.;
          kJ = (1. - smoothstep(8., 125., dJ)) * step(-4., dJ) * step(Xf, 640.);
          float stJ = 0.7 + 0.55 * smoothstep(0.3, 0.7, fbm3(vec2(latJ / 160., (vP.y + (fbm3(vec2(latJ / 90., 3.1)) - 0.5) * 6.) / 2.6)));
          float litJ = smoothstep(280., 430., Xf + (fbm3(vec2(latJ / 150., vP.y / 150.)) - 0.5) * 140.);
          vec3 cJ = mix(cWD * 1.05, cLitC * 0.8, litJ * 0.8) * stJ * pow(fine, 0.6) * aGain;
          cJ.g = min(cJ.g, cJ.r * 0.86); cJ.b = min(cJ.b, cJ.g * 0.92);
          rockW = mix(rockW, cJ, kJ * 0.85);
          if (partJ > 1.5) { gl_FragColor = vec4(kJ, 0.2, 0., 1.); return; }
        }
        float veg = clamp(vCol.r, 0., 1.) * (0.55 + 0.45 * smoothstep(0.3, 0.6, fbm3(vP.xz / 3.))) * (1. - 0.6 * kJ);
        vec3 vegC = (partB > 0.5 ? cVeg2 : cVeg) * (0.55 + 0.9 * fbm3(vP.xz / 1.7)) * (0.6 + 0.5 * upW) * mix(0.5, 1., occ);
        rockW = mix(rockW, vegC, veg * 0.9);
        // parte 3 (zona C): faixa de penhasco de ~80° (tools/part3b_cliff.py), marcada por Data.y entre 3,5 e 6. Colunas com
        // relevo de verdade na malha; textura sem listra: dark_rock + rock_face por ruído grande; #2F231E na sombra, #855F51 na luz
        // quina do topo do penhasco: o Data.y é interpolado entre encosta (3) e penhasco (5) nos triângulos da borda; a parte
        // que caía no ramo da encosta pegava a luz de "quina virada pro céu" e virava um fio claro. À esquerda, a quina toda usa o penhasco.
        if (vData.y > (Xf < 660. && !(dbgP > 1.5) ? 3.02 : 3.5) && partC > 0.5) {
          vec3 Nc = normalize(vN);
          float occC = clamp(vData.x - 2., 0., 1.);
          float dkC = clamp(vCol.g, 0., 1.);
          vec3 wc = pow(abs(Nc), vec3(4.)); wc /= (wc.x + wc.y + wc.z);
          vec3 drk = tri(tDark, vP + 31., wc, 1. / 18.) / mDark;
          vec3 rfc = tri(tDark, vP + 7., wc, 1. / 26.) / mDark;   // tRockF saiu (limite de 16 texturas; o penhasco mostra a imagem do Blender)
          float latC = atan(-vP.z, vP.x) * 1300.;
          float mxC = clamp(smoothstep(0.35, 0.65, fbm3(vec2(latC / 160., vP.y / 140.))) * 0.7 + dkC * 0.3, 0., 1.);
          float detC = clamp(dot(mix(rfc, drk, mxC), vec3(0.2126, 0.7152, 0.0722)), 0.5, 1.7);
          float shfr = 0.;
          float face = clamp(0.4 + 0.8 * dot(Nc, keyW), 0., 1.) * (0.75 + 0.25 * clamp(0.5 + 0.65 * Nc.y, 0., 1.));
          // luz quente na metade da direita (como na foto), em manchas; esquerda e partes escuras ficam na sombra
          float litC = smoothstep(280., 430., Xf + (fbm3(vec2(latC / 150., vP.y / 150.)) - 0.5) * 140.) * (1. - 0.7 * dkC)
                     * (0.55 + 0.45 * smoothstep(0.35, 0.6, fbm3(vec2(latC / 35., vP.y / 60.))));
          float sCc = face * pow(occC, 0.8);
          vec3 cC = mix(cWD * 0.9, cLitC, litC * smoothstep(0.25, 0.85, sCc));
          cC *= mix(mix(0.86, 0.7, litC), mix(1.04, 1.1, litC), smoothstep(0.2, 0.9, sCc));   // na sombra a normal marca menos (sem listra)
          cC = mix(cWK, cC, smoothstep(0.02, 0.4, occC));
          cC *= pow(detC, 0.9) * aGain;
          cC = mix(cC, cWK, shfr * 0.8);
          cC.g = min(cC.g, cC.r * 0.86); cC.b = min(cC.b, cC.g * 0.92);
          // item 73: penhasco feito no Blender (tools/render_cliff.py) = imagem do Blender direto, sem pintar por cima
          if (useBake2 > 0.5 && partH > 0.5) {
            vec3 Dc = texture2D(tBake2, buvS, -0.7).rgb;
            cC = invPost(Dc);
          }
          rockW = cC; wW = 1.;
        }
        bc = mix(bc, rockW, wW);
      }
      // parte 3: rampa abaixo do pé do penhasco. À direita da borda esquerda do leque (de (290,505) até (175,812) no quadro) fica
      // o leque como está; à esquerda, encosta de pedras escuras #3C2F28 com aerial_rocks_02 (zona E)
      if (fRamp > 0.5) {
        vec3 Ne = normalize(vN); vec3 we = pow(abs(Ne), vec3(4.)); we /= (we.x + we.y + we.z);
        float xl = mix(290., 175., clamp((Yf - 505.) / 307., 0., 1.)) + (fbm3(vP.xz / 25.) - 0.5) * 30.;
        float eW = 1. - smoothstep(-6., 6., Xf - xl);
        vec3 ar = mix(tri(tScree, vP, we, 1. / 9.), tri(tScree, vP.zyx + 17., we.zyx, 1. / 23.), 0.4) / mScree;
        float sE = clamp(0.45 + 0.5 * Ne.y + 0.35 * dot(Ne, normalize(vec3(0.55, 0.42, -0.72))), 0.25, 1.2);
        vec3 eC = cRockE * pow(clamp(dot(ar, vec3(0.2126, 0.7152, 0.0722)), 0.3, 2.2), 1.1) * sE * aGain;
        eC = mix(eC, vec3(dot(eC, vec3(0.333))), 0.1);
        bc = mix(bc, eC, eW);
        if (partN > 0.5) {
          // lado esquerdo (pedido): a rampa clara e lisa que aparecia em volta do leque vira
          // A) junto da ponta do leque: cascalho e rocha de tom médio, mais escuro no pé do penhasco, misturando aos poucos
          // B) à direita do leque, embaixo do bosque da ponta do penhasco: chão escuro de mata
          float nA = fbm3(vP.xz / 11.);
          vec3 rockMid = mix(eC * 1.5, cFan * 0.62 * sE * aGain, 0.45) * (0.8 + 0.4 * nA);
          float zA = (1. - smoothstep(330., 380., Xf + (nA - 0.5) * 40.)) * smoothstep(470., 500., Yf);
          float footA = 1. - smoothstep(0., 30., Yf - (512. + (Xf - 295.) * 0.62));   // perto do pé do penhasco, mais sombra
          bc = mix(bc, rockMid * mix(1., 0.72, footA), zA * 0.85);
          float zB = smoothstep(540., 600., Xf + (nA - 0.5) * 50.);
          bc = mix(bc, cFloorV * (0.75 + 0.5 * fbm3(vP.xz / 6.)) * (0.8 + 0.3 * sE), zB * 0.9);
          if (${Q.has('oldrampa') ? 'false' : 'true'}) {
            // pedido ("parece bug"): no vão entre leque e encosta a rampa aparecia como faixa clara e lisa em V. Na foto a divisa é
            // escura, rocha da encosta com arbustos e pinheirinhos. Abaixo do pé do paredão a rampa vira isso (?oldrampa volta)
            float zDiv = ${Q.has('oldrampa2') ? 'smoothstep(560., 600., Yf + (nA - 0.5) * 30.) *' : ''} (1. - zB);   // v3: toda a rampa que aparecer pelos vãos (girando) vira rocha escura, menos o chão de mata junto da floresta
            vec3 divC = eC * (0.8 + 0.35 * fbm3(vP.xz / 2.)) * (0.85 + 0.3 * nA);
            float shr = smoothstep(0.42, 0.6, fbm3(vP.xz / 3.)) * smoothstep(0.3, 0.55, fbm3(vP.xz / 11. + 2.));
            divC = mix(divC, cGrass * 0.5 * (0.7 + 0.6 * fbm3(vP.xz / 0.9)) * sE, shr * 0.75);
            bc = mix(bc, divC, zDiv);
          }
        }
      }
      // parte 4: peças modeladas como decalque pela CAM_FOTO (tools/part4_pieces.py): leque D (Data.y 9) e encosta E (Data.y 11)
      float fFan = step(8., vData.y) * (1. - step(10., vData.y)) * partD, fEE = step(10., vData.y) * (1. - step(12., vData.y)) * partD, fCC = step(12., vData.y) * partD;
      if (fFan + fEE + fCC > 0.5) {
        if (dbgP > 0.5) { gl_FragColor = vec4(fFan > 0.5 ? vec3(1., 0., 0.) : vec3(0., 1., 0.), 1.); return; }
        vec3 Np = normalize(vN); vec3 wp = pow(abs(Np), vec3(4.)); wp /= (wp.x + wp.y + wp.z);
        vec3 lw4 = vec3(0.2126, 0.7152, 0.0722);
        float sP = clamp(0.55 + 0.45 * Np.y + 0.25 * dot(Np, normalize(vec3(0.55, 0.42, -0.72))), 0.3, 1.25);
        if (${Q.has('nosp') ? 'true' : 'false'}) sP = 0.95;   // depuração: sem a luz da normal da malha
        vec2 Pq = vec2(Xf, Yf);
        if (fFan > 0.5) {
          // pedido ("a areia junta com a rocha de forma brusca", 2 recortes): a borda da peça do leque era a aresta reta da malha.
          // Perto da borda o leque some em recorte irregular (0 a 10 px), mostrando a rocha e a mata de trás (?oldborda volta)
          if (${Q.has('oldborda') ? 'false' : 'true'} && Yf < 735.) { float edR = (vData.x - 2.) * 40.; if (edR < fbm3(vP.xz / 2.) * 8. + fbm3(vP.xz / 0.7) * 4. - 2.5) discard; }
          // rocky_gravel em escala real (2,2 e 6,5 m), detalhe sobre a própria média; cor #815E50
          vec3 gv = mix(tri(tGravel, vP, wp, 1. / 2.2), tri(tGravel, vP.zyx + 5., wp.zyx, 1. / 6.5), 0.5);
          float gL = clamp(dot(gv, lw4) / max(dot(triB(tGravel, vP, wp, 1. / 2.2), lw4), 1e-3), 0.4, 2.2);
          // riscos finos descendo a encosta: listras radiais a partir da ponta (295,512), finas no través e longas na descida
          vec2 dA = Pq - vec2(295., 512.); float ang = atan(dA.x, dA.y), rad = length(dA);
          float strk = fbm3(vec2(ang * 300., rad / 70.)) * 0.6 + fbm3(vec2(ang * 900., rad / 40.)) * 0.4;
          float g4 = partE > 0.5 ? 1.6 : 0.7, s4 = partE > 0.5 ? 0.95 : 0.32;          // 4b: o dobro do contraste no grão e nos riscos
          const bool RT = ${Q.has('oldtalus') ? 'false' : 'true'};                     // redo, peça tálus: cascalho fino e liso de longe (?oldtalus volta)
          if (RT) { g4 = 1.0; s4 = 0.6; }   // volta 2: cascalho de verdade e riscos de escorrimento
          if (RT && ${Q.has('oldgrao') ? 'false' : 'true'}) g4 = 0.8;   // revisão: grão fino medido 20% acima da foto (8,2 x 6,9)
          vec3 fanC = cFan * pow(gL, g4) * (1. - s4 * 0.5 + s4 * strk) * sP;
          if (partE > 0.5) {                                                       // pedrinhas e pedras soltas (1 a 3 m), com sombra
            vec2 shv = -normalize(vec2(0.55, -0.72));
            vec3 st = stoneF(vP.xz, 2.8, 0.45, 2.0, shv, 0.7), st2 = stoneF(vP.xz + 7.3, 1.5, 0.3, 0.8, shv, 0.6);
            float stK = RT ? ${Q.has('oldgrao') ? '0.7' : '0.55'} : 1.;
            fanC *= mix(1., 0.5, stK * max(st.z * (1. - st.x), st2.z * (1. - st2.x) * 0.7));
            fanC = mix(fanC, fanC * st.y, st.x * stK); fanC = mix(fanC, fanC * st2.y, st2.x * (1. - st.x) * stK);
          }
          // faixa de areia mais clara e lisa subindo pela borda esquerda (da base (180,662) até a ponta)
          vec2 la = vec2(295., 512.), ab = vec2(180., 662.) - la; float tl = clamp(dot(Pq - la, ab) / dot(ab, ab), 0., 1.);
          float dl = length(Pq - (la + ab * tl));
          float sand = (1. - smoothstep(12., 30., dl + (fbm3(vP.xz / 12.) - 0.5) * 16.)) * smoothstep(0.03, 0.15, tl);
          if (partI > 0.5) sand *= smoothstep(4., 16., (vData.x - 2.) * 40.);   // item 78: a areia clara não encosta na borda
          if (partN > 0.5) sand *= smoothstep(0.35, 0.6, tl);                     // lado esquerdo (pedido): sem franja clara subindo até a ponta
          sand *= ${Q.has('areia') ? '1.' : '0.'};                                        // passo 6 (pedido: "a divisão está muito sólida"): a foto não tem faixa clara na borda
          fanC = mix(fanC, cSand * (0.94 + 0.1 * fbm3(vP.xz / 4.)) * sP, sand * 0.85);
          // mancha de grama verde escura #2C301A do lado esquerdo, a meia altura, em tufos
          float gp = 1. - length((Pq - ${!Q.has('talus2') ? 'vec2(275., 642.)' : 'vec2(306., 650.)'}) / vec2(58., 42.)) + (fbm3(vP.xz / 9.) - 0.5) * 0.9;   // mancha verde da foto (x 230-320, y 610-670); v2: compensa o cone deslocado
          if (partE > 0.5) {
            // 4b: manchas verdes soltas e pequenas, recortadas por ruído fino, cascalho aparecendo entre elas (sem mancha marrom)
            float tuft = smoothstep(0.34, 0.5, fbm3(vP.xz / 1.8)) * smoothstep(0.18, 0.38, fbm3(vP.xz / 6. + 3.1)) * ${Q.has('oldmusgo') ? '1.' : '0.'};   // passo 8: mais denso (foto #49422D); musgo novo mais abaixo
            fanC = mix(fanC, cGrass * (RT ? 0.7 : 1.) * (0.9 + 0.3 * fbm3(vP.xz / 0.8)) * sP, clamp(smoothstep(0.0, 0.25, gp) * tuft * (1. - sand) * (RT ? 0.75 : 1.), 0., 0.92));   // redo: tufos menos vivos (a elipse verde lia como colada)
          } else {
          float gc = smoothstep(0.42, 0.6, fbm3(vP.xz / 3.2));
          fanC = mix(fanC, cGrass * (0.6 + 0.8 * fbm3(vP.xz / 1.5)) * sP, clamp(smoothstep(-0.05, 0.3, gp) * gc * (1. - sand), 0., 0.9));
          }
          if (partI > 0.5) {
            // item 78: borda do leque sem recorte: faixa de 3 a 8 m (largura variando) de cascalho mais grosso e escuro
            // subindo do pé do penhasco e da encosta, com sombra de contato encostada na borda
            float edPx = (vData.x - 2.) * 40.;
            float bw = 6. + 10. * fbm3(vP.xz / 16.);
            float eK = 1. - smoothstep(0., bw, edPx + (fbm3(vP.xz / 2.2) - 0.5) * 4.);
            if (eK > 0.001) {
              vec2 shv2 = -normalize(vec2(0.55, -0.72));
              vec3 sc2 = stoneF(vP.xz + 3.1, 1.3, 0.3, 1.2, shv2, 0.85);
              vec3 edC = mix(cRockE * 1.25, cFan * 0.75, 0.35) * (0.65 + 0.7 * fbm3(vP.xz / 1.1)) * sP;
              edC *= mix(1., 0.55, sc2.z * (1. - sc2.x)); edC = mix(edC, edC * sc2.y * 1.15, sc2.x);
              fanC = mix(fanC, edC, eK * (RT ? 0.45 : 0.92));
              fanC *= 1. - (RT ? 0.18 : 0.42) * eK * eK;   // redo: borda que some no terreno, sem contorno escuro
            }
          }
          fanC *= mix(1.06, 0.84, smoothstep(640., 770., Yf));   // passo 8: pé do leque mais escuro (foto #614C3D)
          // passo 7: linha de arbustos verde escuros na divisa com a encosta (foto #372E25, x 160-330, y 690-770)
          float divE = (vData.x - 2.) * 40.;
          float shrub = (1. - smoothstep(4., 16., divE + (fbm3(vP.xz / 5.) - 0.5) * 10.)) * smoothstep(675., 700., Yf) * (1. - smoothstep(330., 360., Xf)) * smoothstep(0.4, 0.55, fbm3(vP.xz / 2.6));
          fanC = mix(fanC, cGrass * 0.55 * (0.7 + 0.6 * fbm3(vP.xz / 0.9)) * sP, clamp(shrub * 0.9, 0., 0.9));
          if (RT) { float fl = dot(fanC, lw4); fanC = mix(fanC, vec3(fl) * vec3(1.04, 0.98, 0.94), 0.2) * 0.92;
            fanC *= mix(vec3(1.), vec3(0.42, 0.58, 0.30), clamp(smoothstep(-0.45, 0.1, gp), 0., 1.) * (0.6 + 0.4 * smoothstep(0.3, 0.6, fbm3(vP.xz / 2.5))) * ${Q.has('oldmusgo') ? '0.95' : '0.3'});   // medido: mancha verde da foto (71,63,44), oliva escura, falhada
            // textura: riscos finos na linha de queda a partir da ponta e cascalho fino com mais contraste (medido: desvio 7 x 15 na foto)
            fanC *= (0.86 + 0.28 * fbm3(vec2(ang * 1500., rad / 90.))) * (0.85 + 0.3 * fbm3(vP.xz / 0.7));
            if (${Q.has('oldmusgo') ? 'false' : 'true'}) {
              // pedido ("o musgo tá tudo diferente"): na foto o musgo é verde de verdade, em tufos compridos na linha de queda, cobrindo
              // ~48% da mancha (pixels 58,56,35), com o cascalho rosado aparecendo entre eles. Tom = cascalho x (0,34 0,53 0,32) linear
              // v2: mancha da foto medida (centro 250,646, raios 66 x 48 no quadro da CAM_FOTO), tufos mais largos e densos (foto 48%)
              // v4: com o cone deslocado na tela (?oldtalus2), o centro vai ~38 px pra direita e ~7 pra baixo, pra cair no lugar da foto
              float gp2 = 1. - length((Pq - ${!Q.has('talus2') ? 'vec2(250., 646.)) / vec2(66., 48.)' : 'vec2(280., 655.)) / vec2(80., 54.)'}) + (fbm3(vP.xz / 9.) - 0.5) * 0.7;
              // v3 ("tá sólido"): tufos grandes e separados (cascalho aparecendo em pedaços), miolo mais escuro, borda recortada
              float ck = fbm3(vec2(ang * 14., rad / 20.)) * 0.6 + fbm3(vP.xz / 4.5) * 0.3 + fbm3(vP.xz / 0.9) * 0.1;
              float mK = ${!Q.has('talus2') ? 'smoothstep(0.36, 0.44, ck)' : 'smoothstep(0.3, 0.4, ck)'} * smoothstep(-0.15, 0.3, gp2);   // v5: mais cobertura (foto 61,57,37 no miolo)
              vec3 mC = fanC * vec3(0.30, 0.50, 0.24) * mix(1.15, 0.65, smoothstep(0.42, 0.6, ck)) * (0.8 + 0.4 * fbm3(vP.xz / 0.7)) * ${!Q.has('talus2') ? '1.' : '0.85'};
              mC *= mix(vec3(1.), vec3(0.85, 1.25, 0.75), smoothstep(0.45, 0.65, fbm3(vP.xz / 4. + 7.)));   // tufos mais verdes, como na foto
              fanC = mix(fanC, mC, mK * 0.95);
            } }
          bc = fanC * aGain;
        } else if (fCC > 0.5) {
          // centro do vale (pedido): leque de cascalho grande decalcado da foto (tools/part5_cone.py), bege rosado claro,
          // riscos na linha de queda a partir das duas pontas (pé do corredor de neve e canaleta da direita), capim nos lugares da foto
          // crítico q16c: a peça fica 2 m na frente do terreno e tampava a mata dos dois lados; abaixo da linha da mata medida
          // na foto ela some e as árvores aparecem (direita: (1075,672) -> (1150,655) -> (1300,662); esquerda: (800,600) -> (935,735))
          if (${Q.has('nocortecone') ? 'false' : 'true'}) {
            float nqC = (fbm3(vP.xz / 8.) - 0.5) * 6.;
            float flR = Xf < 1100. ? mix(672., 662., (Xf - 1070.) / 30.) : (Xf < 1150. ? mix(662., 655., (Xf - 1100.) / 50.) : (Xf < 1250. ? mix(655., 660., (Xf - 1150.) / 100.) : mix(660., 664., (Xf - 1250.) / 100.)));
            if (Xf > 1070. && Yf > flR + nqC) discard;
            float flL = Yf < 600. ? 790. : (Yf < 630. ? mix(800., 850., (Yf - 600.) / 30.) : (Yf < 685. ? mix(850., 900., (Yf - 630.) / 55.) : mix(900., 935., (Yf - 685.) / 50.)));
            // pedido ("essa parte inteira"): borda esquerda do cascalho medida na foto (tools/fan_edges.py), a mata que tapava saiu (?oldmataesq volta)
            if (${Q.has('oldmataesq') ? 'false' : 'true'}) flL = Yf < 594. ? 792. : (Yf < 636. ? mix(792., 814., (Yf - 594.) / 42.) : (Yf < 677. ? mix(814., 840., (Yf - 636.) / 41.) : (Yf < 698. ? mix(840., 864., (Yf - 677.) / 21.) : (Yf < 709. ? mix(864., 900., (Yf - 698.) / 11.) : mix(900., 949., (Yf - 709.) / 10.)))));
            if (Xf < flL + nqC) discard;
          }
          // costela de rocha entre os dois leques (cunha medida na foto: (935,517) (1047,496) (1061,629) (949,580)); a peça abre ali
          // e aparece a rocha do render atrás, com borda irregular (?nocostela volta)
          float ribK = 0.;
          if (${Q.has('nocostela') ? 'false' : 'true'}) {
            vec2 q = vec2(Xf, Yf) + (vec2(fbm3(vP.xz / 9.), fbm3(vP.xz / 9. + 4.)) - 0.5) * 16.;
            vec2 A0 = vec2(932., 509.), A1 = vec2(1049., 484.), A2 = vec2(1064., 624.), A3 = vec2(947., 573.);   // no quadro da CAM_FOTO (medido no print da visão e convertido)
            float s0 = ((A1.x - A0.x) * (q.y - A0.y) - (A1.y - A0.y) * (q.x - A0.x)) / length(A1 - A0), s1 = ((A2.x - A1.x) * (q.y - A1.y) - (A2.y - A1.y) * (q.x - A1.x)) / length(A2 - A1);
            float s2 = ((A3.x - A2.x) * (q.y - A2.y) - (A3.y - A2.y) * (q.x - A2.x)) / length(A3 - A2), s3 = ((A0.x - A3.x) * (q.y - A3.y) - (A0.y - A3.y) * (q.x - A3.x)) / length(A0 - A3);
            ribK = smoothstep(0., 6., min(min(s0, s1), min(s2, s3)));
            if (${Q.has('ribdbg') ? 'true' : 'false'}) { gl_FragColor = vec4(ribK, 0., 0.3, 1.); return; }
          }
          vec3 gv = mix(tri(tGravel, vP, wp, 1. / 9.), tri(tGravel, vP.zyx + 5., wp.zyx, 1. / 26.), 0.5);
          float gL = clamp(dot(gv, lw4) / max(dot(triB(tGravel, vP, wp, 1. / 9.), lw4), 1e-3), 0.5, 1.8);
          if (${Q.has('nogl') ? 'true' : 'false'}) gL = 1.;   // depuração: sem a textura de cascalho
          float wR = smoothstep(980., 1060., Xf + (Yf - 600.) * 0.6);                               // 0 = leque da esquerda, 1 = cone da direita
          // riscos e canaletas na linha de queda, calculados pra cada ponta e misturados pelo valor (sem redemoinho na emenda)
          vec2 dL = Pq - vec2(918., 552.), dR = Pq - vec2(1062., 500.);
          float aL = atan(dL.x, dL.y), rL = length(dL), aR = atan(dR.x, dR.y), rR = length(dR);
          aL += (fbm3(vec2(rL / 70., aL * 4.)) - 0.5) * 0.16; aR += (fbm3(vec2(rR / 70., aR * 4. + 5.)) - 0.5) * 0.16;   // passo 10: linhas de queda tortas, não raios retos
          float sLt = fbm3(vec2(aL * 140., rL / 60.)) * 0.6 + fbm3(vec2(aL * 420., rL / 30.)) * 0.4;
          float sRt = fbm3(vec2(aR * 140., rR / 60.)) * 0.6 + fbm3(vec2(aR * 420., rR / 30.)) * 0.4;
          float strk = mix(sLt, sRt, wR);
          float gulL = smoothstep(0.45, 0.75, fbm3(vec2(aL * 16., rL / 320.) + 3.7)), gulR = smoothstep(0.45, 0.75, fbm3(vec2(aR * 16., rR / 320.) + 7.1));   // canaletas largas e macias (as finas viraram arranhão)
          float gul = mix(gulL, gulR, wR) * smoothstep(20., 70., mix(rL, rR, wR));                   // canaletas rasas
          if (${Q.has('oldmataesq') ? 'false' : 'true'}) gul *= 1. - (1. - smoothstep(1060., 1100., Xf)) * smoothstep(590., 650., Yf);   // pedido: a canaleta escura descia da ponta até a água; na foto ela some no meio
          // grão do cascalho visível a ~3 km: manchas de 3 a 20 m e pedras maiores escuras espalhadas
          float grain = 0.92 + 0.1 * fbm3(vP.xz / 4.) + 0.08 * fbm3(vP.xz / 17.);
          vec2 shc = -normalize(vec2(0.55, -0.72)); vec3 stc = stoneF(vP.xz, 7., 1.4, 3.5, shc, 0.35);
          // crítico q19j ("folha bege lisa"): média já bate com a foto; falta contraste local dos canais de descida (?lisocone volta)
          bool lisoC = ${Q.has('lisocone') ? 'true' : 'false'};
          float sA = lisoC ? 0.12 : mix(0.12, 0.16, wR), gA = lisoC ? 0.14 : mix(0.14, 0.38, wR);   // só o cone da direita (no leque da esquerda viravam raios)
          if (${Q.has('oldraios') ? 'false' : 'true'}) { sA = mix(0.04, 0.12, wR); gA = mix(0.06, 0.34, wR); }
          if (${Q.has('nostrk') ? 'true' : 'false'}) { sA = 0.; gA = 0.; }   // depuração   // revisão ("textura repetida nos cones de cascalho"): no leque da esquerda os riscos a partir do ápice ainda liam como raios; na foto ele é liso (?oldraios)
          // revisão (cones "chapados e com textura repetida"), medido: grão fino da foto no leque 3,7 de desvio, o nosso 8,0. Grão do
          // cascalho bem mais macio, mais ainda no leque da esquerda (?oldgrao volta)
          vec3 cc = cCone * pow(gL, ${Q.has('oldgrao') ? '0.8' : 'mix(0.3, 0.5, wR)'}) * (1. - sA * 0.5 + sA * strk) * grain * sP * mix(1.0, 0.78, wR) * (0.9 + 0.2 * fbm3(vP.xz / 140.));
          cc *= mix(1., 0.62, stc.x * 0.7 * smoothstep(0.62, 0.78, fbm3(vP.xz / 70.)));             // pedras só em aglomerados
          cc *= (1. - gA * gul) / (1. - gA * 0.2);
          cc *= 1.02 + 0.08 * smoothstep(0.3, 0.75, fbm3(vP.xz / 260.)) + 0.06 * wR;                    // lóbulos bem leves (crítico q16c: borrões escuros)
          cc *= mix(1., 0.95, smoothstep(640., 720., Yf) * (1. - wR));                                // pé quase do mesmo tom (foto #A17D75)
          // capim: riscos finos verdes nos lugares da foto (sem mancha redonda) e a faixa verde escura na borda de cima à direita
          float g1 = 1. - length((Pq - vec2(1062., 615.)) / vec2(32., 34.)), g2 = 1. - length((Pq - vec2(1168., 615.)) / vec2(55., 26.));
          vec2 sa = vec2(1105., 528.), sb = vec2(1285., 612.), sd = sb - sa; float sl = length(Pq - (sa + sd * clamp(dot(Pq - sa, sd) / dot(sd, sd), 0., 1.)));
          float grs = clamp(max(g1, g2) * 2.2, 0., 1.) * (0.45 + 0.55 * smoothstep(0.35, 0.7, fbm3(vec2(aR * 30., rR / 25.)))) * 0.8;   // passo 10: manchas oliva macias (foto #775A50), sem risco de rabisco
          bool oldG = ${Q.has('oldgrs') ? 'true' : 'false'};
          if (oldG) cc *= 1. - 0.16 * clamp(max(g1, g2) * 2., 0., 1.);
          else {
            // bloco 3: capim em RISCOS na linha de queda do cone da direita (foto #6D554A sobre o leque #B69187), não manchas
            // redondas: janelas alongadas no sentido da descida, listras finas no ângulo, bordas irregulares
            float w1 = 1. - length((Pq - vec2(1068., 612.)) / vec2(34., 58.)), w2 = 1. - length((Pq - vec2(1190., 620.)) / vec2(70., 30.));
            float st1 = smoothstep(0.44, 0.58, fbm3(vec2(aR * 11., rR / 90.))) * (0.75 + 0.25 * fbm3(vec2(aR * 30., rR / 25.)));
            float st2 = smoothstep(0.4, 0.58, fbm3(vec2(aR * 8. + 3., rR / 110.))) * (0.8 + 0.2 * fbm3(vec2(aR * 24., rR / 30.)));
            float gS = clamp(max(clamp(w1 * 2.4, 0., 1.) * st1, clamp(w2 * 2.2, 0., 1.) * st2 * 0.85), 0., 1.);
            cc *= 1.08;   // leque um pouco mais claro (foto #B69187, nosso #A68178)
            cc = mix(cc, cc * vec3(0.6, 0.6, 0.5), gS);
            grs = 0.;
          }
          float gline = (1. - smoothstep(3., 8., sl + (fbm3(vP.xz / 20.) - 0.5) * 5.));
          // borda: o cascalho se mistura com o que está atrás (a imagem do Blender da encosta) numa faixa irregular de 4 a 22 px
          float edC = (vData.x - 2.) * 40.;
          float kE = smoothstep(1., 9., edC + (fbm3(vP.xz / 22.) - 0.5) * 8. + (fbm3(vP.xz / 6.) - 0.5) * 4.);
          if (useBake2 > 0.5) {
            vec3 behind = invPost(texture2D(tBake2, buvS, -0.7).rgb);
            // bloco 3: o cascalho do render do Blender é quase branco; na borda virava um halo claro em volta dos afloramentos.
            // A borda pega a textura do render, mas no brilho e no tom do leque (só escurece, nunca clareia)
            if (${Q.has('oldhalo') ? 'false' : 'true'}) {
              float lb = dot(behind, vec3(0.2126, 0.7152, 0.0722)), lc = dot(cc, vec3(0.2126, 0.7152, 0.0722));
              vec3 bAdj = behind * min(1., lc / max(lb, 1e-4));
              behind = mix(bAdj, cc * (dot(bAdj, vec3(0.2126, 0.7152, 0.0722)) / max(lc, 1e-4)), ${Q.has('oldmataesq') ? '0.5' : '0.92'});   // pedido: riscos rosa dentro do cone eram essa borda com a cor do render
            }
            cc = mix(behind, cc, kE);
          }
          else cc = mix(cc * 0.72, cc, kE);
          cc = mix(cc, mix(cc * 0.78, cGrass * 2.2, 0.45) * (0.85 + 0.3 * fbm3(vP.xz / 30.)) * sP, clamp(grs * 0.75, 0., 0.85));   // manchas de capim
          cc = mix(cc, cGrass * 2.2 * (0.85 + 0.3 * fbm3(vP.xz / 30.)) * sP, clamp(gline * 0.7, 0., 0.85) * ${Q.has('oldmataesq') ? '1.' : '0.'});   // faixa verde na borda de cima (substituída pela faixa medida)
          if (${Q.has('oldtalus') ? 'false' : 'true'}) {
            // redo, tálus volta 4 (troca de técnica no leque do centro): bege acinzentado mais escuro, estrias finas e faixas de fluxo
            // escuras na linha de queda, blocos maiores juntando no pé
            float lcc = dot(cc, lw4); cc = mix(cc, vec3(lcc) * vec3(1.04, 0.98, 0.93), 0.15) * 0.94;   // tom medido na foto é bege rosado: só um pouco de cinza
            float flow = smoothstep(0.55, 0.72, fbm3(vec2(mix(aL, aR, wR) * 60., mix(rL, rR, wR) / 140.) + 1.3));
            // revisão ("textura repetida nos cones"): estes riscos a partir do ápice eram os raios finos que sobravam no leque da
            // esquerda; na foto ele é liso, com variação larga. Quase some no leque, um pouco fica no cone da direita (?oldraios2 volta)
            float rdK = ${Q.has('oldraios2') ? '1.' : (Q.has('nostrk') ? '0.' : 'mix(0.12, 0.55, wR)')};
            cc *= (1. + rdK * (0.1 * strk - 0.05)) * (1. - 0.12 * flow * rdK);   // riscos radiais bem suaves (liam como raio)
            if (${Q.has('oldraios2') ? 'false' : 'true'}) cc *= 0.96 + 0.08 * smoothstep(0.25, 0.75, fbm3(vP.xz / 45. + vec2(2.3, 7.1)));   // no lugar: manchas largas e irregulares, sem direção
            vec3 stF = stoneF(vP.xz + 11.7, 5., 1.2, 4., shc, 0.5);
            if (${Q.has('oldgrao') ? 'true' : 'false'}) cc *= mix(1., mix(0.55, 1.1, stF.y), stF.x * smoothstep(620., 700., Yf));
            else cc *= mix(1., mix(0.62, 0.97, clamp(stF.y - 0.5, 0., 1.)), stF.x * smoothstep(620., 700., Yf) * 0.8);   // revisão: as pedras com brilho até 1,4x viravam pontinhos brancos; na foto pedra solta é ponto escuro
          }
          if (${Q.has('oldmataesq') ? 'false' : 'true'}) {
            // pedido ("essa parte inteira precisa de ajustes"), medido caixa a caixa (tools/meas_boxes.py):
            // cone da direita mais quente (foto G/R 0,72 e B/R 0,64, nosso 0,79 e 0,75), ponta clara (184,131,117) e meio mais escuro;
            // leque da esquerda 6% escuro. Capim oliva escuro (foto 109..129,85..100,74..85) e a faixa de pinheiros na diagonal
            cc *= mix(mix(vec3(0.99, 0.89, 0.85), vec3(1.12, 1.09, 1.07), smoothstep(585., 640., Yf)), vec3(1., 0.84, 0.72) * mix(1.22, 0.95, smoothstep(535., 600., Yf)), wR);   // alto do leque da esquerda: foto (166,127,117)
            float w1n = 1. - length((Pq - vec2(1054., 613.)) / vec2(17., 31.)), w2n = 1. - length((Pq - vec2(1154., 613.)) / vec2(35., 23.)), w3n = 1. - length((Pq - vec2(1300., 627.)) / vec2(21., 21.));
            float olv = clamp(max(max(w1n, w2n), w3n) * 2.5, 0., 1.) * (0.55 + 0.45 * smoothstep(0.3, 0.65, fbm3(vec2(aR * 26., rR / 22.))));
            if (${Q.has('oldmusgo') ? 'true' : 'false'}) cc = mix(cc, cc * vec3(0.56, 0.58, 0.5), olv * 0.9);
            else {
              // pedido ("o musgo tá tudo diferente"): musgo da foto 99,80,69 sobre cascalho 141,104,93 = cascalho x (0,46 0,60 0,50) linear,
              // em riscos na linha de queda a partir da ponta, não mancha marrom lisa
              // v2: manchas nos lugares medidos na foto (CAM_FOTO) e cobertura maior (foto 17 a 34% dos pixels na caixa)
              float m1 = 1. - length((Pq - vec2(1057., 618.)) / vec2(22., 37.)), m2 = 1. - length((Pq - vec2(1158., 634.)) / vec2(42., 25.)), m3 = 1. - length((Pq - vec2(1300., 638.)) / vec2(28., 21.));
              // v3 ("tá sólido"): riscos nítidos na linha de queda (verde e cascalho alternando), não mancha borrada
              float mS = smoothstep(0.4, 0.5, fbm3(vec2(aR * 55., rR / 34.)) * 0.7 + fbm3(vP.xz / 3.) * 0.3);
              float mP = clamp(max(max(m1, m2), m3) * 2.2 + (fbm3(vP.xz / 7.) - 0.5) * 0.8, 0., 1.);
              cc = mix(cc, cc * vec3(0.42, 0.58, 0.42) * (0.8 + 0.4 * fbm3(vP.xz / 1.2)), mP * mix(0.25, 1., mS));
            }
            // faixa de pinheiros: polilinha medida (1146,558) (1208,602) (1254,631) (1288,652), 2 a 4 px de meia largura, falhada
            vec2 q0 = vec2(1146., 558.), q1 = vec2(1208., 602.), q2 = vec2(1254., 631.), q3 = vec2(1288., 652.);
            vec2 e0 = q1 - q0, e1 = q2 - q1, e2 = q3 - q2;
            float t0 = clamp(dot(Pq - q0, e0) / dot(e0, e0), 0., 1.), t1 = clamp(dot(Pq - q1, e1) / dot(e1, e1), 0., 1.), t2 = clamp(dot(Pq - q2, e2) / dot(e2, e2), 0., 1.);
            float dS = min(min(length(Pq - q0 - e0 * t0), length(Pq - q1 - e1 * t1)), length(Pq - q2 - e2 * t2));
            // v4 (pedido 2x: "tá sólido, precisa ser natural"): como na foto, duas camadas. Em cima, miolo de pinheiros escuro com a borda
            // de cima serrilhada (ponta de cada copa) e falhas; embaixo, capim verde oliva 2 a 3 vezes mais largo, sumindo no cascalho em
            // riscos na linha de queda. Largura e densidade variam ao longo; nas pontas sobram árvores soltas e o capim continua um pouco
            vec2 Ld = normalize(q3 - q0), Lnn = vec2(-Ld.y, Ld.x);                               // Lnn aponta pra baixo no quadro
            float alg = dot(Pq - q0, Ld), tS = alg / 170.;
            float sd = dot(Pq - q0, Lnn) - 2.5 * sin(3.14159 * clamp(tS, 0., 1.));              // a polilinha curva ~3 px pra baixo no meio
            float hwC = (1.4 + 3.0 * smoothstep(0.05, 0.35, tS) * (1. - smoothstep(0.8, 1., tS))) * (0.75 + 0.5 * fbm3(vec2(tS * 7., 2.1)));   // miolo da foto ~6 px
            float cellT = alg / 2.4 + fbm3(vec2(alg / 6., 0.5)) * 1.5;
            float tipH = (1. - abs(fract(cellT) - 0.5) * 2.) * 2.4 * (0.5 + 0.9 * fract(sin(floor(cellT) * 12.9898) * 43758.5453));
            float crown = fbm3(vP.xz / 1.8);
            float coreK = smoothstep(-(hwC + tipH) - 0.7, -(hwC + tipH) + 0.7, sd) * (1. - smoothstep(hwC * 0.6 - 0.8, hwC * 0.6 + 0.8, sd + (fbm3(vP.xz / 0.9) - 0.5) * 2.));
            coreK *= (1. - 0.85 * smoothstep(0.6, 0.72, fbm3(vec2(alg / 9., 4.4)))) * smoothstep(-0.06, 0.02, tS) * (1. - smoothstep(0.96, 1.04, tS));
            float gw = (4. + 6. * smoothstep(0.1, 0.5, tS)) * (0.7 + 0.6 * fbm3(vec2(tS * 5., 8.)));
            float grassK = smoothstep(-1., 1.5, sd) * (1. - smoothstep(gw * 0.35, gw, sd + (fbm3(vP.xz / 2.) - 0.5) * 4.)) * mix(0.35, 1., smoothstep(0.35, 0.6, fbm3(vec2(aR * 50., rR / 15.))));
            grassK *= smoothstep(-0.04, 0.06, tS) * (1. - smoothstep(1.0, 1.15, tS));
            vec3 grassC = cc * vec3(0.5, 1.0, 0.55) * (0.85 + 0.3 * fbm3(vP.xz / 1.1)) * mix(0.75, 1., smoothstep(0., gw * 0.5, sd));   // foto: capim verde oliva claro (~110,115,75), não marrom
            vec3 treeC = cGrass * vec3(1.2, 1.45, 1.1) * mix(0.5, 1.4, smoothstep(0.3, 0.75, crown)) * (0.8 + 0.4 * fbm3(vP.xz / 0.6)) * sP * mix(1.15, 0.85, smoothstep(-hwC, hwC * 0.6, sd));   // ponta de copa mais clara
            cc = mix(cc, grassC, grassK * 0.95);
            cc = mix(cc, treeC, coreK * 0.95);
            // pedido ("isso tá estranho"): na foto a rocha desce até 15 a 25 px acima da faixa (tools/rock_above.py); aqui sobrava 40 a 60 px
            // de cascalho e a faixa boiava no bege. Acima desse limite o cone vira a rocha do render (tirada 45 px acima), com sombra no pé
            if (useBake2 > 0.5) {
              vec2 L0 = vec2(1146., 558.), Ln = vec2(0.552, -0.834);
              float upL = dot(Pq - L0, Ln);
              float limR = (Xf < 1165. ? 22. : (Xf < 1180. ? mix(22., 9., (Xf - 1165.) / 15.) : (Xf < 1200. ? mix(9., 12., (Xf - 1180.) / 20.) : mix(12., 18., clamp((Xf - 1200.) / 20., 0., 1.)))))
                           + (fbm3(vP.xz / 5.) - 0.5) * 8. + (fbm3(vP.xz / 1.5) - 0.5) * 4.;
              float kRk = smoothstep(limR - 1.5, limR + 1.5, upL) * smoothstep(1135., 1155., Xf) * (1. - smoothstep(1250., 1275., Xf));
              if (${Q.has('rkdbg') ? 'true' : 'false'}) { gl_FragColor = vec4(kRk, 0.3, clamp(upL / 60., 0., 1.), 1.); return; }
              if (kRk > 0.001) {
                vec3 rkA = invPost(min(texture2D(tBake2, buvS + vec2(0., 100. / (3250. * bakeTV)), -0.7).rgb, vec3(0.995))) * vec3(0.70, 1.0, 1.16) * 0.66;
                rkA *= mix(0.7, 1., smoothstep(limR, limR + 6., upL));   // sombra de contato no pé da rocha
                cc = mix(cc, rkA / max(aGain, 1e-3), kRk);
              }
            }
          }
          bc = cc * aGain;
          if (ribK > 0.001 && useBake2 > 0.5) {   // costela: rocha do render tirada ~80 px acima (mesma rocha, cor medida bate com a foto)
            vec3 rk = invPost(texture2D(tBake2, buvS + vec2(0., 80. / (3250. * bakeTV)), -0.7).rgb) * vec3(1.06, 1.04, 0.98) * pow(vec3(122. / 151., 86. / 107., 80. / 102.), vec3(2.0));   // medido: costela 25% clara
            bc = mix(bc, rk, ribK);
          }
        } else {
          // encosta E: aerial_rocks_02 em duas escalas, pedras maiores e escuras #3C2F28
          vec3 ar = mix(tri(tScree, vP, wp, 1. / 12.), tri(tScree, vP.zyx + 17., wp.zyx, 1. / 31.), 0.45) / mScree;
          float aL = clamp(dot(ar, lw4), 0.45, 1.9);
          bc = cRockE * 1.02 * pow(aL, 1.5) * sP * aGain;   // passo 7: contraste normal e grão maior (foto: blocos médios, pouco brilho)
          if (partE > 0.5) {                                                      // pedras soltas de tamanhos variados, com sombra
            vec2 shv = -normalize(vec2(0.55, -0.72));
            vec3 s1 = stoneF(vP.xz, 5.5, 1.2, 3.8, shv, 0.5), s2 = stoneF(vP.xz + 13.7, 2.4, 0.4, 1.2, shv, 0.45);   // lajes maiores
            bc *= mix(1., 0.5, max(s1.z * (1. - s1.x), s2.z * (1. - s2.x) * 0.7));
            bc = mix(bc, bc * s1.y * 1.1, s1.x); bc = mix(bc, bc * s2.y, s2.x * (1. - s1.x));
          }
          if (${Q.has('oldmarrom') ? 'false' : 'true'}) {
            // pedido ("tirar o marrom daqui"): na foto a encosta escura para na diagonal de (100,635) a (250,780); acima dela, até o pé do
            // paredão, é cascalho bege do tálus. A parte da encosta acima dessa linha vira cascalho com a cor do leque (?oldmarrom volta)
            float nE = fbm3(vP.xz / 9.);
            float lineE = 635. + (Xf - 100.) * 0.97 + (nE - 0.5) * 26.;
            // v2 (pedido: "essa mancha tá errada"): a linha acima era íngreme demais e a parte de baixo da encosta virou uma cunha rosa lisa.
            // Linha da borda de cima da encosta medida na foto: (21,584) -> (310,765) no quadro da CAM_FOTO (?oldmancha volta)
            if (${Q.has('oldmancha') ? 'false' : 'true'}) lineE = 584. + (Xf - 21.) * 0.626 + (nE - 0.5) * 14. + (fbm3(vP.xz / 2.5) - 0.5) * 5.;
            // v3 (pedido: "a areia junta com a rocha de forma brusca"): divisa recortada em várias escalas e faixa de transição com
            // pedras soltas e arbustos, em vez de uma linha reta (?oldemenda volta)
            if (${Q.has('oldemenda') ? 'false' : 'true'}) lineE += (fbm3(vP.xz / 6. + 1.7) - 0.5) * 22. + (fbm3(vP.xz / 1.4) - 0.5) * 7.;
            float kG = (1. - smoothstep(lineE - 14., lineE + 6., Yf)) * smoothstep(110., 140., Xf);
            if (${Q.has('oldemenda') ? 'false' : 'true'}) {
              float bandE = 1. - smoothstep(0., 16., abs(Yf - lineE + 4.));
              kG = clamp(kG + (fbm3(vP.xz / 0.8) - 0.5) * 1.6 * bandE, 0., 1.) * smoothstep(110., 140., Xf);   // pedras soltas dos dois lados
              float shE = bandE * smoothstep(0.45, 0.62, fbm3(vP.xz / 2.2 + 5.1)) * smoothstep(0.3, 0.55, fbm3(vP.xz / 9. + 2.));
              bc = mix(bc, cGrass * 0.6 * (0.7 + 0.6 * fbm3(vP.xz / 0.8)) * sP * aGain, shE * 0.8 * (1. - kG));   // arbustos na divisa, como na foto
            }
            if (${Q.has('oldcaminho') ? 'false' : 'true'}) {
              // pedido ("parece mancha"): o cascalho claro aqui virava um triângulo largo e liso. Na foto é um caminho estreito de areia
              // (~30 px) que sobe junto da borda esquerda do leque, de (169,668) até o pé do paredão em (283,512); fora dele, pedregulho escuro
              vec2 sa0 = vec2(283., 512.), sab = vec2(169., 668.) - sa0; float tsa = clamp(dot(Pq - sa0, sab) / dot(sab, sab), 0., 1.);
              float dSL = length(Pq - sa0 - sab * tsa) + (fbm3(vP.xz / 4.) - 0.5) * 10. + (fbm3(vP.xz / 1.2) - 0.5) * 4.;
              kG *= 1. - smoothstep(12., 22., dSL);
            }
            float gLe = clamp(dot(mix(tri(tScree, vP, wp, 1. / 3.), tri(tScree, vP.zyx + 5., wp.zyx, 1. / 8.), 0.5) / mScree, lw4), 0.55, 1.6);
            vec3 gE = cFan * pow(gLe, 0.9) * sP * aGain * 0.95;
            bc = mix(bc, gE, kG);
          }
        }
        if (${Q.has('oldsaia') ? 'false' : 'true'}) {
          // pedido ("tá horrível nesse ângulo"): as peças foram modeladas pra vista da câmera principal; girando, aparecem as laterais
          // quase verticais (borda que afunda) com textura esticada em espinho. Lateral = rocha escura da encosta em sombra (?oldsaia volta)
          float skirt = smoothstep(0.5, 0.25, Np.y);
          // v2 (pedido: "tire essa mancha marrom, ela não existe"): lateral com a cor do próprio cascalho (leque) ou da encosta, um pouco
          // mais escura, sem virar mancha marrom
          vec3 skC = (fFan + fCC > 0.5 ? cFan * 0.8 : cRockE * 0.9) * (0.85 + 0.3 * fbm3(vP.xz / 1.7 + vP.y / 2.)) * aGain;
          bc = mix(bc, skC, skirt * 0.85);
        }
        if (partK > 0.5) {   // item 85: linha de pedra molhada onde o leque e a encosta encostam na água
          float wet = 1. - smoothstep(0.15, 1.4 + 0.8 * fbm3(vP.xz / 6.), vP.y);
          bc *= mix(1., 0.5, wet); bc = mix(bc, bc * vec3(0.85, 0.95, 1.0), wet);
        }
      }
      // alpenglow: só onde o sol baixo enxerga (máscara assada) E só nos dois cumes que pegam sol na foto:
      // forte no pico da extrema direita, fraco no pico pequeno da extrema esquerda; os outros ficam em luz difusa
      float pkR = exp(-(pow((fq0.x - 0.915) / 0.055, 2.) + pow((fq0.y - 0.215) / 0.05, 2.)));
      float pkL = 0.5 * exp(-(pow((fq0.x - 0.222) / 0.022, 2.) + pow((fq0.y - 0.175) / 0.028, 2.)));
      // ponto 10: chão da mata da encosta direita verde escuro (#1b2414), sem bege entre as copas; ponto 11: margem direita = linha fina de pedra molhada escura
      float rightF = smoothstep(0.58, 0.64, fq0.x) * smoothstep(1.5, 4., vP.y) * (1. - smoothstep(110., 170., vP.y)) * (1. - smoothstep(2600., 3200., dN));   // só onde a mata sobe a encosta
      bc = mix(bc, vec3(0.0105, 0.0175, 0.0071) * 0.9, rightF * 0.85);
      float shoreR = step(0.55, fq0.x) * (1. - smoothstep(0.6, 3.2, vP.y));
      bc = mix(bc, vec3(0.012, 0.011, 0.010), shoreR * 0.85);
      float pebble = step(0.58, fq0.x) * smoothstep(0.15, 0.35, vP.y) * (1. - smoothstep(0.8, 1.3, vP.y)) * smoothstep(0.42, 0.6, fbm3(vP.xz / 3.));
      bc = mix(bc, vec3(0.19, 0.17, 0.145), pebble * 0.8);   // linha fina de pedra clara na beira da água (margem direita)
      if (${Q.has('oldmanchas') ? 'false' : 'true'} && vData.y < 8.) {
        // pedido ("essa aqui também não existe"): entre o leque e a floresta, abaixo do penhasco, a área marrom lisa vira chão de
        // mata escuro (na foto ali é mata descendo do pé do penhasco); o pé do penhasco escondido atrás da encosta (aparece girando)
        // vira rocha escura da encosta, sem faixa clara (?oldmanchas volta)
        float mN = fbm3(vP.xz / 7.);
        float zM = smoothstep(560., 600., Xf + (mN - 0.5) * 40.) * (1. - smoothstep(760., 800., Xf)) * smoothstep(555., 585., Yf + (mN - 0.5) * 30.) * (1. - smoothstep(715., 740., Yf));
        vec3 mC = cFloorV * (0.65 + 0.5 * fbm3(vP.xz / 2.5)) * (0.85 + 0.3 * smoothstep(0.4, 0.7, fbm3(vec2(vP.x + vP.z, vP.y * 3.) / 4.)));
        bc = mix(bc, mC, zM * 0.9);
        float zP = step(2.5, vData.y) * (1. - step(7.5, vData.y)) * (1. - smoothstep(320., 360., Xf)) * smoothstep(575., 605., Yf);
        // v3 (pedido: "tire esse marrom"): o pé liso e marrom do paredão logo acima da encosta (aparece girando) vira rocha da encosta
        // mais escura, com arbustos e pinheirinhos esparsos, subindo até ~480 no quadro da CAM_FOTO
        float zP2 = (1. - step(7.5, vData.y)) * (1. - smoothstep(320., 360., Xf + (mN - 0.5) * 40.)) * smoothstep(480., 530., Yf + (mN - 0.5) * 40.) * (1. - zP);
        zP = max(zP, zP2 * 0.95);
        // v4 (faixa clara à direita do leque, girando): pé quase plano do penhasco escondido atrás do leque recebia a cor clara do render;
        // só as partes quase planas (a face ocre é vertical e não muda) viram rocha escura
        float zPF = step(4.5, vData.y) * (1. - step(6.5, vData.y)) * smoothstep(0.45, 0.65, normalize(vN).y) * smoothstep(300., 340., Xf) * (1. - smoothstep(680., 720., Xf)) * smoothstep(480., 520., Yf);
        zP = max(zP, zPF);
        if (zP > 0.001) {   // v2: mesma textura de pedras da encosta (a cor lisa virava mancha marrom)
          vec3 Nz = normalize(vN); vec3 wz = pow(abs(Nz), vec3(4.)); wz /= (wz.x + wz.y + wz.z);
          vec3 arz = mix(tri(tScree, vP, wz, 1. / 12.), tri(tScree, vP.zyx + 17., wz.zyx, 1. / 31.), 0.45) / mScree;
          float aLz = clamp(dot(arz, vec3(0.2126, 0.7152, 0.0722)), 0.45, 1.9);
          vec3 rz = cRockE * 1.02 * pow(aLz, 1.5) * clamp(0.55 + 0.45 * Nz.y, 0.3, 1.2) * aGain * mix(1., 0.78, zP2);
          float shz = smoothstep(0.5, 0.64, fbm3(vP.xz / 2.6)) * smoothstep(0.35, 0.6, fbm3(vP.xz / 13. + 5.));
          rz = mix(rz, cGrass * 0.45 * (0.7 + 0.6 * fbm3(vP.xz / 0.9)) * aGain, shz * 0.7);   // arbustos e pinheirinhos esparsos
          if (${Q.has('oldbase') ? 'false' : 'true'} && vData.y > 4.5 && vData.y < 5.5) {
            // pedido ("arruma esse problema", triângulo entre paredão, encosta e leque): é a base do próprio paredão (?datadbg), que aqui
            // recebia a textura de chão esticada na parede e lia como borrão liso. Rocha de parede: fendas verticais, blocos, patamares
            float hcB = vP.x * 0.83 + vP.z * 0.56;
            float frZ = fbm3(vec2(hcB / 4.5, vP.y / 30.)) * 0.6 + fbm3(vec2(hcB / 1.8, vP.y / 11.)) * 0.4;
            float crZ = smoothstep(0.36, 0.27, frZ);
            float blZ = 0.7 + 0.6 * smoothstep(0.3, 0.7, fbm3(vec2(hcB / 14., vP.y / 9.)));
            float ldZ = smoothstep(0.55, 0.7, fbm3(vec2(hcB / 60., vP.y / 2.2) + 4.1));
            vec3 wallC = cRockE * vec3(0.95, 0.85, 0.75) * (0.4 + 1.1 * (blZ - 0.7) / 0.6) * (1. - 0.7 * crZ) * (0.8 + 0.4 * fbm3(vec2(hcB / 0.9, vP.y / 0.9))) * (1. + 0.6 * ldZ) * aGain;   // v2: mais contraste, marrom da foto
            float trZ = smoothstep(0.55, 0.68, fbm3(vec2(hcB / 7., vP.y / 7.) + 9.)) * (1. - crZ);
            wallC = mix(wallC, cGrass * 0.5 * (0.7 + 0.6 * fbm3(vP.xz / 0.9)) * aGain, trZ * 0.6);
            rz = wallC;
          }
          bc = mix(bc, rz, zP * 0.9);
          // v5 (pedido: "eu pedi pra tirar o marrom daqui"): entre a encosta e o paredão, à esquerda da ponta do leque, a foto tem o
          // cascalho bege do tálus subindo até o pé do paredão. Ali vira cascalho com textura e cor do leque (sem faixa lisa, sem marrom)
          float zG = smoothstep(540., 575., Yf + (mN - 0.5) * 30.) * (1. - smoothstep(705., 730., Yf)) * smoothstep(120., 155., Xf) * (1. - smoothstep(320., 350., Xf + (mN - 0.5) * 30.));
          if (${Q.has('oldmancha') ? 'false' : 'true'}) zG *= 1. - smoothstep(-6., 6., Yf - (584. + (Xf - 21.) * 0.626) + (mN - 0.5) * 14.);   // só acima da borda da encosta medida na foto
          if (${Q.has('oldcaminho') ? 'false' : 'true'}) {   // e só no caminho estreito de areia da foto (fora dele fica a rocha escura do pé do paredão)
            vec2 sb0 = vec2(283., 512.), sbb = vec2(169., 668.) - sb0; vec2 Pz = vec2(Xf, Yf); float tsb = clamp(dot(Pz - sb0, sbb) / dot(sbb, sbb), 0., 1.);
            zG *= 1. - smoothstep(12., 22., length(Pz - sb0 - sbb * tsb) + (fbm3(vP.xz / 4.) - 0.5) * 10.);
          }
          if (zG > 0.001) {
            float gLz = clamp(dot(mix(tri(tScree, vP, wz, 1. / 3.), tri(tScree, vP.zyx + 5., wz.zyx, 1. / 8.), 0.5) / mScree, vec3(0.2126, 0.7152, 0.0722)), 0.55, 1.6);
            vec3 grz = cFan * pow(gLz, 0.9) * clamp(0.6 + 0.4 * Nz.y, 0.4, 1.1) * aGain * 0.95;
            bc = mix(bc, grz, zG);
          }
        }
      }
      if (${Q.has('oldmataesq') ? 'false' : 'true'} && vData.y < 8. && Xf > 780. && Xf < 1360. && Yf > 500. && Yf < 725.) {
        // pedido ("essa parte inteira precisa de ajustes"): chão que aparece dentro do contorno dos leques do centro medido na foto
        // vira cascalho do leque: embaixo, onde a mata saiu (leque da esquerda até a água), e os riscos rosa no cone da direita
        // (terreno do render furando a peça, visto no ?datadbg)
        float flL2 = Yf < 594. ? 792. : (Yf < 636. ? mix(792., 814., (Yf - 594.) / 42.) : (Yf < 677. ? mix(814., 840., (Yf - 636.) / 41.) : (Yf < 698. ? mix(840., 864., (Yf - 677.) / 21.) : (Yf < 709. ? mix(864., 900., (Yf - 698.) / 11.) : mix(900., 949., (Yf - 709.) / 10.)))));
        float topL = Xf < 1094. ? 520. : (Xf < 1156. ? mix(521., 542., (Xf - 1094.) / 62.) : (Xf < 1203. ? mix(542., 584., (Xf - 1156.) / 47.) : (Xf < 1266. ? mix(584., 598., (Xf - 1203.) / 63.) : mix(598., 635., (Xf - 1266.) / 78.))));
        float inL = smoothstep(0., 4., Xf - flL2) * step(594., Yf) * (1. - smoothstep(1000., 1020., Xf));
        float inR = smoothstep(4., 10., Yf - topL) * step(1080., Xf) * (1. - step(668., Yf));
        float zF = max(inL, inR);
        if (zF > 0.001) {
          vec3 Nf = normalize(vN); vec3 wf = pow(abs(Nf), vec3(4.)); wf /= (wf.x + wf.y + wf.z); vec3 lwf = vec3(0.2126, 0.7152, 0.0722);
          vec3 gvf = mix(tri(tGravel, vP, wf, 1. / 9.), tri(tGravel, vP.zyx + 5., wf.zyx, 1. / 26.), 0.5);
          float gLf = clamp(dot(gvf, lwf) / max(dot(triB(tGravel, vP, wf, 1. / 9.), lwf), 1e-3), 0.5, 1.8);
          vec3 gF = cCone * pow(gLf, 0.8) * (0.92 + 0.1 * fbm3(vP.xz / 4.) + 0.08 * fbm3(vP.xz / 17.)) * mix(vec3(1.05, 1.02, 1.0), vec3(0.74, 0.62, 0.53), inR) * aGain;
          bc = mix(bc, gF, zF);
        }
      }
      // alpenglow e névoa agora vêm prontos do render do Cycles: o three.js só mostra o render (bakeFx=1 volta o efeito antigo, só pra depurar)
      if (bakeFx > 0.5) {
        float sunM = smoothstep(0.06, 0.45, vCol.r) * max(pkR, pkL);
        float lbk = dot(bc, vec3(0.2126, 0.7152, 0.0722));
        vec3 litc = cSun * clamp(lbk / 0.11, 0.55, 1.7);
        bc = mix(bc, litc, sunM * 0.92); bc = applyHaze(bc, vP);
      }
      // curva do tálus e fim do paredão (pedido: "essa vegetação não existe ali, é tipo uma curva"), em qualquer chão da região:
      // abaixo da diagonal do pé do paredão medida na foto, (300,540) -> (690,762), o cascalho do leque continua até a água;
      // acima dela, entre o fim do render do penhasco e a mata (x 590-660), rocha escura do pé do paredão (foto #29231D)
      if (${Q.has('nocurva') ? 'false' : 'true'} && partN > 0.5 && Xf > 520. && Xf < 750. && Yf > 590. && Yf < 790. && vData.y < 8.) {
        float notCliff = (vData.y < 4.5 || vData.y > 5.5) ? 1. : 0.;
        vec3 Nc = normalize(vN); vec3 wc = pow(abs(Nc), vec3(4.)); wc /= (wc.x + wc.y + wc.z);
        float sC = clamp(0.55 + 0.45 * Nc.y + 0.25 * dot(Nc, normalize(vec3(0.55, 0.42, -0.72))), 0.3, 1.25);
        float dLn = Yf - (540. + (Xf - 300.) * 0.5692) + (fbm3(vP.xz / 9.) - 0.5) * 10. + (fbm3(vP.xz / 2.5) - 0.5) * 3.;
        float zC = smoothstep(-3., 4., dLn) * smoothstep(530., 560., Xf) * (1. - smoothstep(715., 740., Xf));
        vec3 lwC = vec3(0.2126, 0.7152, 0.0722);
        if (zC > 0.001) {
          vec3 gvC = mix(tri(tGravel, vP, wc, 1. / 2.2), tri(tGravel, vP.zyx + 5., wc.zyx, 1. / 6.5), 0.5);
          float gLC = clamp(dot(gvC, lwC) / max(dot(triB(tGravel, vP, wc, 1. / 2.2), lwC), 1e-3), 0.4, 2.2);
          vec2 dAC = vec2(Xf, Yf) - vec2(295., 512.); float angC = atan(dAC.x, dAC.y), radC = length(dAC);
          float strC = fbm3(vec2(angC * 300., radC / 70.)) * 0.6 + fbm3(vec2(angC * 900., radC / 40.)) * 0.4;
          vec3 tC = cFan * pow(gLC, 1.6) * (0.525 + 0.95 * strC) * sC;
          vec2 shC = -normalize(vec2(0.55, -0.72)); vec3 stC = stoneF(vP.xz, 2.8, 0.45, 2.0, shC, 0.7);
          tC *= mix(1., 0.5, stC.z * (1. - stC.x)); tC = mix(tC, tC * stC.y, stC.x);
          tC *= mix(0.62, 1., smoothstep(0., 16., dLn)) * mix(0.82, 1., smoothstep(700., 600., Xf));   // sombra de contato no pé do paredão; mais escuro na ponta (foto #624E43)
          bc = mix(bc, tC * aGain, zC);
        }
        // acima da diagonal: base do paredão em rocha marrom escura (foto #372823 e #29231D), onde a nossa malha do penhasco termina alto
        float zR = notCliff * (1. - smoothstep(-4., 2., dLn)) * smoothstep(515., 535., Xf) * (1. - smoothstep(648., 662., Xf + (fbm3(vP.xz / 7.) - 0.5) * 14.)) * smoothstep(596., 612., Yf);
        if (zR > 0.001) {
          vec3 rk = tri(tDark, vP, wc, 1. / 18.) / mDark;
          vec3 rC = mix(vec3(0.019, 0.0125, 0.0105), vec3(0.034, 0.018, 0.0145), smoothstep(640., 560., Xf)) * clamp(dot(rk, lwC) / max(dot(mDark, lwC), 1e-3), 0.4, 2.0) * (0.7 + 0.6 * fbm3(vec2((vP.x + vP.z) * 0.25, vP.y / 9.))) * sC;   // canaletas verticais
          bc = mix(bc, rC, zR * 0.95);
        }
      }      // sopé dos paredões da direita (pedido, foto medida): cascalho rosado claro (#A9776D) no pé da rocha com manchas de neve
      // em cunha (#DBACA1) apontando pra cima; a mata (mais baixa ali) fica na frente
      if (${Q.has('sope') ? 'true' : 'false'} && Rh > 1100. && Xf > 1300. && Xf < 1940. && Yf > 530. && Yf < 670.) {
        vec2 qS = vec2(dot(vP.xz, vec2(0.857, 0.514)), vP.y);
        float wob = (fbm3(qS / 12.) - 0.5) * 7. + (fbm3(qS / 3.) - 0.5) * 2.5;
        vec2 pS = vec2(Xf, Yf);
        float footS = Xf < 1440. ? mix(598., 606., (Xf - 1320.) / 120.) : mix(606., 625., (Xf - 1440.) / 200.);
        float scrM = smoothstep(-1.5, 1.5, Yf - footS + wob) * smoothstep(1312., 1326., Xf) * (1. - smoothstep(1630., 1650., Xf + wob));
        vec3 scrC = vec3(0.663, 0.467, 0.427) * (0.86 + 0.28 * fbm3(qS / 4.)) * mix(1., 0.72, smoothstep(0.62, 0.72, fbm3(qS / 1.6))) * mix(1., 0.85, smoothstep(612., 650., Yf));
        float dS = capS(pS, vec2(1322., 564.), vec2(1362., 596.), 0.6, 28.);
        dS = min(dS, capS(pS, vec2(1320., 540.), vec2(1352., 556.), 0.5, 28.));
        dS = min(dS, capS(pS, vec2(1462., 571.), vec2(1482., 613.), 0.8, 44.));
        dS = min(dS, capS(pS, vec2(1528., 588.), vec2(1542., 615.), 0.8, 22.));
        dS = min(dS, capS(pS, vec2(1584., 600.), vec2(1600., 623.), 0.8, 22.));
        dS = min(dS, capS(pS, vec2(1690., 575.), vec2(1708., 605.), 0.8, 18.));
        dS = min(dS, capS(pS, vec2(1748., 515.), vec2(1840., 583.), 0.5, 13.));
        dS = min(dS, capS(pS, vec2(1835., 560.), vec2(1858., 585.), 0.7, 14.));
        dS = min(dS, capS(pS, vec2(1882., 516.), vec2(1918., 550.), 0.6, 9.));
        // relevo da rocha que está embaixo (luminância do render): neve e cascalho herdam as canaletas, sem cor chapada
        vec3 Dr = texture2D(tBake2, buvS, -0.7).rgb; float rel = clamp(0.62 + 1.25 * (dot(Dr, vec3(0.3, 0.5, 0.2)) - 0.3), 0.45, 1.2);
        float fn = fbm3(vec2(qS.x / 1.6, qS.y / 6.));                         // grão alongado no sentido da queda
        float edgeN = (fn - 0.5) * 7. + wob * 0.9;
        float snM = 1. - smoothstep(-2.5, 1., dS + edgeN);
        float frg = (1. - smoothstep(0., 9., dS + wob)) * smoothstep(0.58, 0.72, fbm3(vec2(qS.x / 2.2, qS.y / 5.))) * 0.75;   // retalhos soltos em volta
        snM = max(snM, frg);
        float lit = mix(1.06, 0.8, smoothstep(-0.4, 0.9, sideS));               // esquerda acesa, direita na sombra
        vec3 snC = mix(vec3(0.859, 0.675, 0.631), vec3(0.70, 0.55, 0.54), smoothstep(-0.2, 0.9, sideS)) * lit;
        snC *= mix(1., rel, 0.55) * (0.93 + 0.12 * fn);
        snC *= 1. - 0.3 * smoothstep(0.62, 0.74, fbm3(vec2(qS.x / 2.5, qS.y / 16.)));   // sujeira escorrendo e costela de rocha
        snC = mix(snC, scrC, smoothstep(-5., 0., dS + edgeN) * 0.5);           // borda suja, encosta no cascalho
        scrC *= mix(1., rel, 0.6) * (0.92 + 0.16 * fbm3(vec2(qS.x / 1.2, qS.y / 9.)));
        scrM *= 0.85 + 0.15 * fn;
        bc = mix(bc, invPost(scrC), scrM);
        bc = mix(bc, invPost(snC), snM);
      }
      if (${Q.has('nonevoa') ? 'false' : 'true'} && Rh > 2150.) {
        // redo (pedido: "e a neblina?"): névoa atmosférica por distância nas montanhas do fundo; cristas mais longe mais
        // enevoadas que as da frente, no tom do céu atrás (malva rosado), mais forte embaixo (vale) que no topo
        float dC = length(vP.xz - camRef.xz);
        float fz = smoothstep(2600., 7500., dC) * 0.30 + smoothstep(2600., 4200., dC) * 0.06;   // pedido: véu leve (0,46 ficou demais, voltou pro meio)
        fz *= mix(1.0, 0.65, smoothstep(300., 1400., vP.y));
        fz += 0.05 * (1. - smoothstep(120., 650., vP.y)) * smoothstep(2400., 4200., dC);   // névoa baixa e leitosa no pé das montanhas, no vale
        fz *= 1. - smoothstep(0.72, 0.86, (bc.r - bc.b) / max(bc.r, 1e-3));   // cume aceso (laranja saturado) fica sem névoa, como na foto
        vec3 hz = mix(vec3(0.62, 0.52, 0.58), vec3(0.72, 0.56, 0.52), smoothstep(900., 1700., Xf));   // malva à esquerda, salmão à direita
        bc = mix(bc, invPost(hz), fz);
        // medido: montanha do meio atrás do paredão 15% clara (foto 80,63,62)
        bc *= mix(vec3(1.), vec3(0.69, 0.74, 0.79), smoothstep(570., 620., Xf) * (1. - smoothstep(760., 820., Xf)) * smoothstep(400., 450., Yf) * (1. - smoothstep(640., 680., Yf)));
        // medido (v58): mata do render no alto da encosta da direita 30 a 38% clara (foto 37,37,23 x 48,51,32); só pixel verde de mata
        if (${Q.has('oldmata') ? 'false' : 'true'} && Xf > 1380. && Yf > 540. && Yf < 720.) {
          float gm = smoothstep(-0.005, 0.01, bc.g - bc.r * 0.95) * smoothstep(1380., 1460., Xf);
          bc *= mix(vec3(1.), vec3(0.6, 0.55, 0.55), gm);
        }
        // medido (v50): sombra entre os maciços do centro-direita 19% clara (foto 134,90,87 x cena 165,105,97), ganho ^2 com borda larga
        bc *= mix(vec3(1.), vec3(0.66, 0.74, 0.81), smoothstep(1090., 1160., Xf) * (1. - smoothstep(1300., 1370., Xf)) * smoothstep(370., 430., Yf) * (1. - smoothstep(510., 570., Yf)));
        // pedido ("essa parte inteira"): neve à direita do cone rosa demais (foto 222,182,172 x nossa 245,187,178), só nos pixels claros
        if (${Q.has('oldmataesq') || Q.has('oldmarcas') ? 'false' : 'true'} && Xf > 1180. && Yf > 495. && Yf < 660.) {
          // pedido ("essa marca não existe na referência"): faixa de baixo das montanhas da direita, logo acima da mata, estava 40% clara
          // e vermelha (foto 133,92,87 x 191,128,119) e a neve rosa (foto 220,181,171 x 245,188,176). Rocha e neve com ganhos medidos
          float zMk = smoothstep(1180., 1230., Xf) * smoothstep(495., 525., Yf) * (1. - smoothstep(640., 660., Yf));
          float snK = smoothstep(0.3, 0.42, dot(bc, vec3(0.2126, 0.7152, 0.0722)));
          // neve v4 (contorno da foto): a sombra do relevo deixava parte da neve abaixo do limiar e ela pegava o ganho da rocha (listras
          // cinza azuladas). Neve = clara E pouco saturada (rocha acesa daqui é saturada, ~0,38) (?oldnevek volta)
          if (${Q.has('oldnevek') ? 'false' : 'true'}) { float mxK = max(bc.r, max(bc.g, bc.b)); float stK = (mxK - min(bc.r, min(bc.g, bc.b))) / max(mxK, 1e-4);
            float lK = dot(bc, vec3(0.2126, 0.7152, 0.0722));
            snK = max(smoothstep(0.16, 0.26, lK) * smoothstep(0.55, 0.45, stK), smoothstep(0.28, 0.36, lK) * smoothstep(0.64, 0.58, stK)); }   // saturação no linear (~2x a do sRGB); neve rosa acesa (sat ~0,56) é clara: entra pelo segundo termo
          // v2 (medido em 4 caixas): à esquerda escurece menos, à direita mais; o cascalho claro de baixo (y > 590) fica como está
          float gR = Xf < 1360. ? mix(0.70, 0.49, smoothstep(1330., 1400., Xf)) : mix(0.49, 0.37, smoothstep(1600., 1700., Xf));
          zMk *= mix(1., 1. - smoothstep(582., 600., Yf), 1. - snK);
          bc *= mix(vec3(1.), mix(vec3(1., 1.18, 1.33) * gR, ${Q.has('nevepagina') ? 'vec3(0.68, 0.86, 0.9)' : 'vec3(1.)'}, snK), zMk);   // a neve já vem no tom da foto na imagem
          // cascalho claro embaixo dos cones de neve: vermelho demais (medido em 3 caixas: foto 168,123,111 x 190,124,114), ganho no linear
          if (${Q.has('oldcascalho') ? 'false' : 'true'}) bc *= mix(vec3(1.), vec3(0.77, 1.0, 0.98), smoothstep(1200., 1260., Xf) * (1. - smoothstep(1640., 1720., Xf)) * smoothstep(578., 596., Yf) * (1. - smoothstep(650., 670., Yf)) * (1. - snK));
          if (${Q.has('mkdbg') ? 'true' : 'false'}) { gl_FragColor = vec4(zMk, snK, 0., 1.); return; }
        }
        if (${Q.has('olddirsombra') ? 'false' : 'true'} && Xf > 1500. && Yf > 270. && Yf < 520.) {
          // jogo dos erros 23, 24, 26, 30: montanhas da direita acesas em salmão; na foto estão na sombra (medido em 7 caixas:
          // à esquerda ~28% claras, abaixo do pico laranja até 45%), e o laranja só no alto do cume (linha ~352 no quadro da CAM_FOTO);
          // logo abaixo do cume a foto é marrom avermelhado (180,92,58), não laranja (239,99,18). Neve fica (?olddirsombra volta)
          float lumR = dot(bc, vec3(0.2126, 0.7152, 0.0722));
          float mxR = max(bc.r, max(bc.g, bc.b)), mnR = min(bc.r, min(bc.g, bc.b)); float satR = (mxR - mnR) / max(mxR, 1e-4);
          float snR = smoothstep(0.32, 0.45, lumR) * (1. - smoothstep(0.55, 0.75, satR));
          float zS = smoothstep(1500., 1560., Xf) * smoothstep(275., 310., Yf) * (1. - smoothstep(500., 530., Yf));
          float capL = 340. + (fbm3(vec2(Xf / 40., 3.3)) - 0.5) * 18. + (fbm3(vec2(Xf / 9., Yf / 9.)) - 0.5) * 14. + (Xf - 1850.) * 0.06;
          float orK = smoothstep(0.45, 0.68, satR) * smoothstep(0.05, 0.12, lumR) * smoothstep(capL - 10., capL + 26., Yf);
          bc = mix(bc, vec3(lumR) * vec3(1.9, 0.75, 0.42) * 0.62, orK * zS);                            // laranja abaixo do cume vira marrom avermelhado
          // v2 (medido de novo: a v1 escureceu 20 a 40% demais e ficou cinza): ganho menor e mais vermelho, como o marrom da foto
          vec3 gS = mix(vec3(0.80, 0.68, 0.70), vec3(0.64, 0.54, 0.60), smoothstep(1680., 1780., Xf));
          // v3 (medido): à esquerda o alto ainda claro (foto 149,90,81) e o baixo escuro (foto 142,85,78); à direita o baixo escuro
          gS *= mix(mix(vec3(0.82, 0.76, 0.76), vec3(1.42, 1.42, 1.62), smoothstep(380., 450., Yf)), mix(vec3(1.), vec3(1.3, 1.22, 1.3), smoothstep(400., 460., Yf)), smoothstep(1680., 1780., Xf));
          gS = mix(gS, vec3(1.), smoothstep(capL + 10., capL - 14., Yf) * smoothstep(1740., 1780., Xf));   // o cume aceso não escurece
          bc *= mix(vec3(1.), gS, zS * (1. - snR));
        }
        if (${Q.has('oldmataesq') || !Q.has('oldmarcas') ? 'false' : 'true'} && Xf > 1270. && Xf < 1480. && Yf > 495. && Yf < 625.) {
          float snL = smoothstep(0.3, 0.42, dot(bc, vec3(0.2126, 0.7152, 0.0722))) * smoothstep(1270., 1300., Xf) * (1. - smoothstep(1450., 1480., Xf)) * smoothstep(495., 515., Yf) * (1. - smoothstep(605., 625., Yf));
          bc *= mix(vec3(1.), vec3(0.80, 0.94, 0.91), snL);
        }
        // pedido ("isso tá estranho", faixa de pinheiros boiando no bege): o bege acima da faixa é o cascalho do próprio render.
        // Na foto a rocha desce até ~18 px acima da faixa: nessa faixa de 35 px o render é lido 40 px acima (rocha), com sombra no pé
        if (${Q.has('oldmataesq') ? 'false' : 'true'} && Xf > 1090. && Xf < 1290. && Yf > 470. && Yf < 660.) {
          vec2 L0 = vec2(1146., 558.), Ln = vec2(0.552, -0.834);
          float upL = dot(vec2(Xf, Yf) - L0, Ln);
          // v2 (?rkdbg mostrou): o cascalho do render sobe ~80 px; a rocha é lida 100 px acima e levada ao tom medido na foto (112,80,76)
          // v3: distância da rocha à faixa medida por coluna na foto (perpendicular): 22 no alto, 9 a 12 no meio, 18 embaixo
          float limR = (Xf < 1165. ? 22. : (Xf < 1180. ? mix(22., 9., (Xf - 1165.) / 15.) : (Xf < 1200. ? mix(9., 12., (Xf - 1180.) / 20.) : mix(12., 18., clamp((Xf - 1200.) / 20., 0., 1.)))))
                       + (fbm3(vP.xz / 5.) - 0.5) * 8. + (fbm3(vP.xz / 1.5) - 0.5) * 4.;
          float topR = ${Q.has('oldplaca') ? '0.' : '(fbm3(vP.xz / 14.) - 0.5) * 40. + (fbm3(vP.xz / 4.) - 0.5) * 12.'};   // jogo dos erros: borda de cima reta lia como placa
          float kR2 = smoothstep(limR - 1.5, limR + 1.5, upL) * (1. - smoothstep(limR + 62. + topR, limR + 80. + topR, upL)) * smoothstep(1110., 1135., Xf) * (1. - smoothstep(1250., 1275., Xf));
          if (${Q.has('oldplaca') ? 'false' : 'true'}) kR2 *= smoothstep(472., 500., Yf + (fbm3(vP.xz / 10.) - 0.5) * 24.);   // a zona começa em Yf 470: sem isso a borda de cima era uma reta (placa cinza)
          if (${Q.has('rkdbg') ? 'true' : 'false'}) { gl_FragColor = vec4(0., kR2, clamp(upL / 60., 0., 1.), 1.); return; }
          if (kR2 > 0.001) {
            vec3 rkB = invPost(min(texture2D(tBake2, buvS + vec2(0., 100. / (3250. * bakeTV)), ${Q.has('oldplaca') ? '-0.7' : '0.5'}).rgb, vec3(0.995))) * vec3(0.70, 1.0, 1.16) * 0.66;   // medido: rocha da foto marrom-malva, a do render vermelha demais
            if (${Q.has('oldplaca') ? 'false' : 'true'}) rkB *= (0.8 + 0.4 * fbm3(vec2((vP.x + vP.z) / 3., vP.y / 6.))) * vec3(1.06, 0.97, 0.94);   // v4: lida borrada (a neve de 100 px acima virava pintas cinza) + grão próprio, menos azul
            rkB = mix(rkB, vec3(0.11, 0.07, 0.065) * (0.8 + 0.4 * fbm3(vP.xz / 2.)), smoothstep(0.16, 0.3, dot(rkB, vec3(0.2126, 0.7152, 0.0722))));   // neve que vinha junto (lia azulada) vira rocha
            rkB *= mix(0.7, 1., smoothstep(limR, limR + 6., upL));
            bc = mix(bc, rkB, kR2);
          }
        }
        // costela de rocha entre os leques do centro (fora da peça do leque, o render mostra cascalho rosado claro): ganho medido
        // (foto 122,86,80 x cena 151,107,102), cunha no quadro da CAM_FOTO com borda irregular (?nocostela volta)
        if (${Q.has('nocostela') ? 'false' : 'true'} && Xf > 900. && Xf < 1090. && Yf > 470. && Yf < 650.) {
          vec2 q = vec2(Xf, Yf) + (vec2(fbm3(vP.xz / 9.), fbm3(vP.xz / 9. + 4.)) - 0.5) * 16.;
          vec2 A0 = vec2(932., 509.), A1 = vec2(1049., 484.), A2 = vec2(1064., 624.), A3 = vec2(947., 573.);
          float s0 = ((A1.x - A0.x) * (q.y - A0.y) - (A1.y - A0.y) * (q.x - A0.x)) / length(A1 - A0), s1 = ((A2.x - A1.x) * (q.y - A1.y) - (A2.y - A1.y) * (q.x - A1.x)) / length(A2 - A1);
          float s2 = ((A3.x - A2.x) * (q.y - A2.y) - (A3.y - A2.y) * (q.x - A2.x)) / length(A3 - A2), s3 = ((A0.x - A3.x) * (q.y - A3.y) - (A0.y - A3.y) * (q.x - A3.x)) / length(A0 - A3);
          bc *= mix(vec3(1.), vec3(0.65, 0.65, 0.62), smoothstep(0., 6., min(min(s0, s1), min(s2, s3))));
        }
      }
      if (${Q.has('oldmacico') ? 'false' : 'true'} && useBake2 > 0.5 && Rh > 2150. && Xf > 500. && Xf < 860. && Yf > 150. && Yf < 620.) {
        // jogo dos erros 17 e 20: face direita do maciço grande acesa e quente na foto (152,110,106 em cima, 140,100,98 no meio) e aqui
        // 18 a 30% escura e cinza; e o morro com mata na frente do maciço (embaixo à esquerda, foto 85,71,69) aqui era rocha (?oldmacico)
        float lumM = dot(bc, vec3(0.2126, 0.7152, 0.0722));
        float faceM = smoothstep(655., 690., Xf) * (1. - smoothstep(790., 830., Xf)) * smoothstep(185., 215., Yf) * (1. - smoothstep(400., 440., Yf));
        vec3 gM = mix(vec3(2.1, 1.95, 1.9), vec3(1.55, 1.48, 1.45), smoothstep(290., 330., Yf));
        bc *= mix(vec3(1.), gM, faceM * (1. - smoothstep(0.3, 0.45, lumM)));
        float hillTop = Xf < 567. ? mix(507., 440., (Xf - 532.) / 35.) : (Xf < 614. ? mix(440., 413., (Xf - 567.) / 47.) : (Xf < 661. ? mix(413., 405., (Xf - 614.) / 47.) :
                        (Xf < 708. ? mix(405., 419., (Xf - 661.) / 47.) : mix(419., 467., clamp((Xf - 708.) / 41., 0., 1.)))));
        hillTop += (fbm3(vec2(Xf / 6., 2.2)) - 0.5) * 6.;                                              // topo recortado por copas
        // v2 (a v1 virou mancha lisa): borda macia, some na rocha à direita, e a textura vem do relevo do próprio render + copas
        float hillK = smoothstep(hillTop - 6., hillTop + 10., Yf) * smoothstep(525., 545., Xf) * (1. - smoothstep(690., 760., Xf + (fbm3(vec2(Yf / 20., 3.)) - 0.5) * 50.)) * 0.88;
        float crown = fbm3(vec2(Xf / 4., Yf / 7.)) * 0.55 + fbm3(vec2(Xf / 12., Yf / 10.)) * 0.45;
        vec3 Dh = texture2D(tBake2, buvS, -0.7).rgb, Dh3 = texture2D(tBake2, buvS, 3.).rgb;
        float relH = clamp(dot(Dh, vec3(0.2126, 0.7152, 0.0722)) / max(dot(Dh3, vec3(0.2126, 0.7152, 0.0722)), 1e-3), 0.6, 1.5);
        vec3 hillC = invPost(vec3(85., 71., 69.) / 255.) * pow(relH, 1.6) * (0.55 + 0.9 * crown) * mix(1.05, 0.9, smoothstep(440., 560., Yf));
        bc = mix(bc, hillC, hillK);
      }
      if (${Q.has('nevepagina') ? 'true' : 'false'} && useBake2 > 0.5 && Rh > 2150. && Yf < 650.) {   // substituída pela neve na própria imagem (tools/snow_layout.py)
        // pedido ("só falta as neves naturais"; jogo dos erros 15, 19, 28): na foto a neve é branca com toque rosado, de borda nítida
        // e recortada, nos patamares em riscos quebrados e numa capa no topo do maciço. Aqui era rosa salmão ou cinza salpicado.
        // 1) neve do render (clara e pouco saturada) vira o branco da foto com a sombra do próprio relevo;
        // 2) as linhas claras regulares das camadas (mais claras que 3 px acima e abaixo) viram neve quebrada nos patamares;
        // 3) borda nítida e recortada por ruído fino (?oldnevenat volta)
        vec3 Dn = texture2D(tBake2, buvS, -0.7).rgb; vec3 lwn = vec3(0.2126, 0.7152, 0.0722);
        float lrn = dot(Dn, lwn); float mxn = max(Dn.r, max(Dn.g, Dn.b)), mnn = min(Dn.r, min(Dn.g, Dn.b)); float srn = (mxn - mnn) / max(mxn, 1e-3);
        float snR = smoothstep(0.56, 0.7, lrn) * (1. - smoothstep(0.3, 0.46, srn));
        // v3 (cuidado com a disposição): os campos de neve de baixo cobriam o dobro da foto (28% x 15%) em lençóis retos. Na foto são
        // línguas em cone no pé das canaletas: mais neve embaixo, quebrando em pontas pra cima
        float lowN = smoothstep(505., 535., Yf);
        float thrN = mix(0.36, 0.66, smoothstep(612., 545., Yf));
        snR *= mix(1., smoothstep(thrN - 0.04, thrN + 0.04, fbm3(vec2(Xf / 9., Yf / 26.)) * 0.65 + fbm3(vec2(Xf / 30., Yf / 30.)) * 0.35), lowN);
        float dvn = 2.5 / (3250. * bakeTV);
        float lun = dot(texture2D(tBake2, buvS + vec2(0., dvn), -0.7).rgb, lwn), ldn = dot(texture2D(tBake2, buvS - vec2(0., dvn), -0.7).rgb, lwn);
        float ledN = smoothstep(0.035, 0.09, lrn - max(lun, ldn)) * (1. - smoothstep(0.42, 0.58, srn));
        float brkN = smoothstep(0.5, 0.62, fbm3(vec2(Xf / 16., Yf / 3.5)) * 0.7 + fbm3(vec2(Xf / 5., Yf / 5.)) * 0.3);
        brkN *= smoothstep(0.42, 0.58, fbm3(vec2(Xf / 90., Yf / 60.) + 5.3));                          // v2: em grupos, como na foto (não em todas as faces)
        float hiN = 1. - smoothstep(420., 500., Yf);                                                     // patamares com neve na metade de cima
        float corN = 1. - smoothstep(0., 30., min(Xf - 790., 975. - Xf)) * step(285., Yf);                // o corredor tem a neve dele
        float snK = max(snR, ledN * brkN * hiN * 0.95) * (Xf > 790. && Xf < 975. && Yf > 285. ? 0. : 1.);
        // v4 (pedido: "não pode piorar a cena"): o cascalho claro dos leques e tálus também é claro e pouco saturado e virava neve.
        // Neve só na rocha acima do pé dos paredões e nos campos de neve medidos na foto (x 1290-1960, y 495-640)
        float fansN = smoothstep(470., 500., Yf) * (1. - step(1290., Xf));
        float fieldN = smoothstep(1290., 1310., Xf) * (1. - smoothstep(1940., 1965., Xf));
        snK *= 1. - fansN * (1. - fieldN);
        snK *= 1. - smoothstep(560., 600., Yf) * (1. - fieldN);
        snK = smoothstep(0.3, 0.6, snK + (fbm3(vec2(Xf / 2.6, Yf / 2.6)) - 0.5) * 0.4 + (fbm3(vec2(Xf / 9., Yf / 9.)) - 0.5) * 0.2);
        float shN = clamp((lrn - 0.42) / 0.38, 0., 1.);
        vec3 snC = mix(vec3(0.72, 0.62, 0.62), vec3(0.88, 0.76, 0.72), shN) * (0.95 + 0.08 * fbm3(vec2(Xf / 4., Yf / 1.5)));   // v2: branco rosado medido na foto (220,181,171), não branco puro
        bc = mix(bc, invPost(snC), snK);
      }
      if (${Q.has('oldneve2') ? 'false' : 'true'} && Rh > 2150. && Xf > 770. && Xf < 1020. && Yf > 260. && Yf < 580.) {
        // pedido ("a cor da montanha também"), medido por zona em volta do corredor: a face à direita do corredor pega luz na foto e
        // aqui estava em sombra (foto 153,105,98 x 110,77,75), a face da esquerda 15 a 20% escura, e a base 15% clara. Só na rocha
        // (a neve das saliências não estoura) (?oldneve2 volta)
        float lumB = dot(bc, vec3(0.2126, 0.7152, 0.0722));
        float rockW = 1. - smoothstep(0.3, 0.5, lumB);
        float zNA = smoothstep(870., 895., Xf) * (1. - smoothstep(975., 1005., Xf)) * smoothstep(270., 290., Yf) * (1. - smoothstep(405., 440., Yf));
        float zNB = smoothstep(780., 795., Xf) * (1. - smoothstep(828., 842., Xf)) * smoothstep(320., 340., Yf) * (1. - smoothstep(410., 435., Yf));
        float zNC = smoothstep(780., 795., Xf) * (1. - smoothstep(920., 945., Xf)) * smoothstep(425., 455., Yf) * (1. - smoothstep(555., 580., Yf));
        bc *= mix(vec3(1.), vec3(1.) + vec3(0.8, 0.78, 0.72) * zNA + vec3(0.35) * zNB - vec3(0.28) * zNC, rockW);
      }
      if (${Q.has('oldneve') ? 'false' : 'true'} && Rh > 2150. && Xf > 790. && Xf < 975. && Yf > 285. && Yf < 600.) {
        // redo, peça corredor de neve (?oldneve volta): linha estreita e limpa na diagonal, traçado medido na foto
        // v5 (pedido: "essa neve continua diferente"): traçado e largura medidos linha a linha na foto (tools/snow_path.py): estreita no
        // alto (~10 px), ~14 px no meio, leque de ~25 a 30 px embaixo e língua que volta pra esquerda no pé; sem trechos de rocha
        // cortando a neve (liam como blocos cinza); branco rosado da foto (216,188,181), mais frio que o creme antigo
        vec2 pp = vec2(Xf, Yf); float dmin = 1e5; float tY = 0.;
        vec2 PT[13]; PT[0] = vec2(826., 292.); PT[1] = vec2(847., 323.); PT[2] = vec2(847., 354.); PT[3] = vec2(852., 385.); PT[4] = vec2(861., 406.); PT[5] = vec2(874., 427.);
        PT[6] = vec2(891., 448.); PT[7] = vec2(907., 469.); PT[8] = vec2(914., 490.); PT[9] = vec2(920., 512.); PT[10] = vec2(929., 532.); PT[11] = vec2(927., 555.); PT[12] = vec2(921., 575.);
        for (int i = 0; i < 12; i++) { vec2 a = PT[i], b = PT[i + 1], ab = b - a; float t = clamp(dot(pp - a, ab) / dot(ab, ab), 0., 1.); float dd = length(pp - a - ab * t); if (dd < dmin) { dmin = dd; tY = (float(i) + t) / 12.; } }
        float en = (fbm3(vP.xz / 7. + vP.y / 9.) - 0.5) * 7. + (fbm3(vP.xz / 1.6 + vP.y / 2.) - 0.5) * 5.;
        float relE = dot(texture2D(tBake2, buvS, 0.).rgb, vec3(0.3, 0.5, 0.2));
        en += (0.33 - relE) * 14.;   // borda quebrada pelo relevo: rocha escura (sombra, saliência) entra na neve, rocha clara deixa a neve avançar
        float hw = (5. + 2. * smoothstep(0.1, 0.45, tY) + 7. * smoothstep(0.5, 0.72, tY) * (1. - smoothstep(0.82, 1., tY)) - 3. * smoothstep(0.85, 1., tY)) * (0.8 + 0.4 * fbm3(vec2(tY * 12., 1.7)));
        float sm = 1. - smoothstep(hw - 1.5, hw + 1.5, dmin + en);
        float pat = smoothstep(0.66, 0.74, fbm3(vP.xz / 5. + vP.y / 6.)) * (1. - smoothstep(14., 40., dmin)) * smoothstep(0.35, 0.6, dot(texture2D(tBake2, buvS, 1.).rgb, vec3(0.3, 0.5, 0.2)));
        sm = max(sm, pat * 0.85);                                                                                              // manchas soltas nas saliências
        vec3 Db = texture2D(tBake2, buvS, -0.7).rgb; float lb = dot(Db, vec3(0.2126, 0.7152, 0.0722));
        // neve larga antiga fora da linha: vira rocha (tom da rocha vizinha, do mip grosso), só onde era claro e azulado
        float oldS = smoothstep(0.3, 0.5, lb) * smoothstep(-0.06, 0.04, Db.b - Db.r * 0.85) * (1. - smoothstep(26., 44., dmin));
        vec3 rk = texture2D(tBake2, buvS, 5.).rgb; rk = rk * 0.62 / max(dot(rk, vec3(0.2126, 0.7152, 0.0722)), 0.05) * 0.38;
        rk *= ${Q.has('oldneve') ? 'vec3(1.)' : 'vec3(1.12, 0.96, 0.92)'};   // v5: rocha marrom avermelhada da foto, não cinza
        bc = mix(bc, invPost(rk * (0.75 + 0.5 * fbm3(vP.xz / 3. + vP.y / 4.))), oldS * (1. - sm));
        float relS = clamp(0.75 + 0.9 * (dot(texture2D(tBake2, buvS, 1.).rgb, vec3(0.3, 0.5, 0.2)) - 0.3), 0.7, 1.1);   // a neve herda o relevo do sulco
        vec3 snw = mix(vec3(0.86, 0.79, 0.77), vec3(0.70, 0.64, 0.66), smoothstep(-2., 4., dmin - hw * 0.2 + en * 0.3)) * relS * (0.9 + 0.14 * fbm3(vec2(vP.x + vP.z, vP.y * 2.) / 2.5));
        // volta 4 (troca de técnica): neve assentada numa ravina. Sombra na rocha junto das bordas, neve opaca com
        // sombra forte do relevo (lado direito do sulco em sombra), sem véu leitoso
        float rav = (1. - smoothstep(hw, hw + 9., dmin + en * 0.5)) * (1. - sm);
        bc *= 1. - 0.22 * rav;   // v5: sombra da ravina mais leve (a rocha junto da neve estava escura demais)
        float sideR = smoothstep(-hw, hw, (pp.x - mix(830., 926., tY)) - (dmin * 0.)) ;
        snw *= mix(1.08, 0.72, sideR * smoothstep(0.2, 1., dmin / max(hw, 1.)));
        snw = vec3(0.84, 0.70, 0.66) * mix(1.04, 0.82, sideR * smoothstep(0.3, 1., dmin / max(hw, 1.))) * (0.97 + 0.05 * fbm3(vP.xz / 6.));   // creme liso como na foto, sem os veios da neve antiga
        // v5: branco rosado da foto (216,188,181 na média, lado aceso ~228,202,196), estrias finas no sentido da descida e lado direito em sombra
        float strkN = fbm3(vec2(dot(pp, vec2(0.92, -0.38)) / 2.2, tY * 26.));
        if (${Q.has('oldneve') ? 'false' : 'true'}) {
          snw = vec3(0.894, 0.792, 0.768) * mix(1.03, 0.84, sideR * smoothstep(0.2, 1., dmin / max(hw, 1.))) * (0.95 + 0.08 * fbm3(vec2(dot(pp, vec2(0.92, -0.38)) / 3.5, tY * 14.))) * (0.98 + 0.04 * fbm3(vP.xz / 6.));
          // v7 (pedido: "parece um brush, não que faz parte da pedra"; "granulada"): a neve herda o relevo da rocha embaixo (luz e sombra
          // das saliências do render), sem ruído fino
          float lr0 = dot(texture2D(tBake2, buvS, 0.).rgb, vec3(0.3, 0.5, 0.2)), lr3 = dot(texture2D(tBake2, buvS, 3.).rgb, vec3(0.3, 0.5, 0.2));
          snw *= clamp(0.97 + 0.18 * (lr0 / max(lr3, 0.02) - 1.), 0.88, 1.05);   // v8: relevo leve (com 0,45 a neve ficou cinza e suja)
          // v6 (neve lisa demais): frestas finas cinza azuladas no sentido da descida, mais no leque de baixo, como na foto
          float crev = smoothstep(0.6, 0.7, fbm3(vec2(dot(pp, vec2(0.92, -0.38)) / 1.3, tY * 18. + 3.1))) * mix(0.4, 1., smoothstep(0.45, 0.75, tY));
          snw = mix(snw, snw * vec3(0.78, 0.8, 0.86), crev * 0.8);
        }
        // fim do redo: neve fosca com a mesma névoa da montanha (antes brilhava como cachoeira de luz)
        float dCs = length(vP.xz - camRef.xz); float fzs = smoothstep(2600., 7500., dCs) * 0.34 + smoothstep(2600., 4200., dCs) * 0.08;
        snw = mix(snw * 1.05, vec3(0.62, 0.52, 0.58), fzs * 0.4);   // branco creme como na foto (estava cinza)
        bc = mix(bc, invPost(snw), clamp(sm * 1.3, 0., 1.));
      }
      if (${Q.has('oldparedao') ? 'false' : 'true'} && vData.y < 6.) {   // só o paredão (a rampa, tipo 7, ficava clara no pé girando a câmera)
        // redo, peça paredão (?oldparedao volta): estratos horizontais pela altura do mundo (box), textura escaneada cliff_side
        // deitada, tom em zonas grandes (ocre na luz, cinza amarronzado na sombra); só na face do paredão da esquerda
        float PX = fq0.x * 2000., PY = fq0.y * 1333.;
        float xe = PY < 250. ? 230. + PY * 0.72 : 410. + (PY - 250.) * 0.66;
        float wM = (1. - smoothstep(xe - 30., xe + 5., PX)) * (1. - smoothstep(600., 660., PY)) * (1. - smoothstep(2000., 2300., length(vP.xz - camRef.xz)));
        if (${Q.has('wdbg') ? 'true' : 'false'}) { gl_FragColor = vec4(wM, 0., 1. - wM, 1.); return; }
        if (wM > 0.001) {
          float hc = vP.x * 0.83 + vP.z * 0.56;
          float dip = fbm3(vec2(hc / 900., 0.3)) * 40.;
          vec3 lw5 = vec3(0.2126, 0.7152, 0.0722);
          float Ls = clamp(dot(texture2D(tRock, vec2(hc / 70., (vP.y + dip) / 16.)).rgb / mRock, lw5), 0.45, 1.7);
          float Lt = 0.68 + 0.64 * fbm3(vec2(hc / 260., (vP.y + dip) / 3.2));
          if (${Q.has('oldtelha') ? 'false' : 'true'}) {
            // jogo dos erros 7: cristas finas e regulares no paredão inteiro (telha). Na foto a rocha é lisa com estrutura grande e as
            // camadas finas aparecem só numa faixa do meio (quadro da CAM_FOTO x 155-280, y 140-280) (?oldtelha volta)
            float stB = smoothstep(130., 170., PX) * (1. - smoothstep(270., 320., PX)) * smoothstep(120., 160., PY) * (1. - smoothstep(270., 310., PY));
            Lt = mix(0.85 + 0.3 * fbm3(vec2(hc / 180., (vP.y + dip) / 16.)), Lt, stB * 0.85);
            Ls = pow(Ls, mix(0.35, 1., stB));   // a textura de paredão deitada (cristas finas) fica forte só na faixa de camadas
            // as cristas vêm também do render (degraus da malha): na parte de cima, fora da faixa de camadas, o brilho do render é
            // suavizado na vertical (média de 9 amostras em ~16 px), mantendo a cor
            float zUp = (1. - smoothstep(330., 380., PY)) * (1. - stB) * wM;
            if (useBake2 > 0.5 && zUp > 0.001) {
              float dvU = 2. / (3250. * bakeTV); vec3 vs = vec3(0.);
              for (int i = -4; i <= 4; i++) vs += texture2D(tBake, buvS + vec2(0., float(i) * dvU * 1.6)).rgb;   // as cristas vêm do bake antigo (tBake), assado sobre a malha em degraus
              vs /= 9.; vec3 v0 = texture2D(tBake, buvS).rgb;
              bc *= mix(1., clamp(pow(dot(vs, lw5) / max(dot(v0, lw5), 1e-3), 2.2), 0.5, 2.), zUp);
            }
          }
          float Lb = 0.8 + 0.4 * smoothstep(0.3, 0.7, fbm3(vec2(hc / 500., (vP.y + dip) / 9.)));   // bancadas mais grossas, claro/escuro
          float zone = smoothstep(0.35, 0.65, fbm3(vec2(hc / 160., vP.y / 120.)));
          vec3 tint = mix(vec3(0.92, 0.88, 0.88), vec3(1.12, 0.98, 0.84), zone);
          vec3 sb = mix(bc, vec3(dot(bc, lw5)) * vec3(1.15, 0.95, 0.85), 0.3);   // tira parte do listrado vertical do tom de base, mantendo o marrom
          // volta 3: estrutura grande (blocos e reentrâncias com sombra funda), faixa de penhasco ocre quente na base, topo mais escuro
          float blk = fbm3(vec2(hc / 70., vP.y / 55.)); float blkS = mix(0.55, 1.25, smoothstep(0.3, 0.7, blk));
          float rec = smoothstep(0.62, 0.7, fbm3(vec2(hc / 25., vP.y / 80.) + 2.3)); blkS *= 1. - 0.45 * rec;   // fraturas verticais em sombra
          float baseB = smoothstep(400., 470., PY) * (1. - smoothstep(560., 640., PY));
          vec3 ocre = mix(vec3(1.), vec3(1.08, 1.0, 0.92), baseB);   // volta 4: base cinza marrom dessaturada (o laranja uniforme perdeu)
          sb = mix(sb, vec3(dot(sb, lw5)) * vec3(1.08, 0.98, 0.9), 0.45 * baseB);
          blkS *= mix(1., 0.6 + 0.8 * smoothstep(0.25, 0.75, fbm3(vec2(hc / 18., vP.y / 22.))), baseB);   // blocos fraturados na faixa de baixo
          float topD = mix(0.82, 1., smoothstep(80., 300., PY)) * mix(0.68, 0.88, smoothstep(250., 450., PY));   // medido: paredão alto 20% claro demais
          bc = mix(bc, sb * pow(Ls, 1.5) * Lt * Lb * tint * 0.68 * blkS * ocre * topD, wM * 0.9);   // volta 2: marrom escuro como na foto
          // faixa de baixo (penhasco do render): as listras verticais vêm do render. Média horizontal do brilho dele apaga a
          // listra vertical e mantém a camada horizontal; por cima, estratos horizontais pela altura do mundo (?oldfaixa volta)
          float zLow = smoothstep(340., 400., PY) * wM;
          if (${Q.has('oldfaixa') ? 'false' : 'true'} && useBake2 > 0.5 && zLow > 0.001) {
            float du = 1. / (3250. * bakeTH); vec3 hs = vec3(0.);
            for (int i = -4; i <= 4; i++) hs += texture2D(tBake2, buvS + vec2(float(i) * 3. * du, 0.), -0.7).rgb;
            hs /= 9.; vec3 s0 = texture2D(tBake2, buvS, -0.7).rgb;
            // pedido ("pelo amor de Deus arruma esse problema"): na base do paredão, perto do caminho e da encosta (PY > 450), a média
            // horizontal virava um borrão liso. Lá ela cai e entra rocha com fendas verticais, blocos e patamares (?oldbase volta)
            float zLb = ${Q.has('oldbase') ? '0.' : (Q.has('oldbase2') ? 'smoothstep(440., 480., PY) * (1. - smoothstep(340., 380., PX))' : 'smoothstep(350., 400., PY)')};   // v3 (erro 9): rocha com fendas em toda a parte de baixo, não só perto do caminho
            bc *= mix(1., clamp(dot(hs, lw5) / max(dot(s0, lw5), 1e-3), 0.6, 1.6), zLow * 0.85 * (1. - zLb * ${Q.has('oldbase2') ? '1.' : '0.'}));   // v3: a média horizontal fica (tira os escorridos do render)
            bc *= mix(1., 0.72 + 0.56 * fbm3(vec2(hc / 300., (vP.y + dip) / 4.5)), zLow * 0.7 * (1. - zLb * 0.6));
            if (zLb > 0.001) {
              float frB = fbm3(vec2(hc / 4.5, (vP.y + dip) / 30.)) * 0.6 + fbm3(vec2(hc / 1.8, (vP.y + dip) / 11.)) * 0.4;
              float crB = smoothstep(0.36, 0.27, frB);                                                   // fendas verticais escuras
              // v2 (medido: foto 36,27,21 com desvio 24; aqui 47,38,32 com desvio 9): mais contraste, tom marrom mais escuro e quente
              float blB = 0.5 + 1.0 * smoothstep(0.3, 0.7, fbm3(vec2(hc / 14., (vP.y + dip) / 9.)));      // blocos claro/escuro
              float ledB = smoothstep(0.55, 0.7, fbm3(vec2(hc / 60., (vP.y + dip) / 2.2) + 4.1));           // patamares horizontais claros
              float grB = 0.8 + 0.4 * fbm3(vec2(hc / 0.9, (vP.y + dip) / 0.9));                           // grão da rocha
              vec3 rkB = bc * vec3(0.78, 0.7, 0.62) * blB * (1. - 0.7 * crB) * grB * (1. + 0.6 * ledB);
              rkB *= ${Q.has('oldbase2') ? 'vec3(1.)' : 'mix(vec3(1.), vec3(1.32, 1.36, 1.42), smoothstep(380., 420., PY))'};   // v3 medido: a parte de baixo ficou 30% escura (C 34 x 44, D 62 x 69)
              float trB = smoothstep(0.55, 0.68, fbm3(vec2(hc / 7., (vP.y + dip) / 7.) + 9.)) * (1. - crB);   // pinheirinhos nas fendas, como na foto
              rkB = mix(rkB, cGrass * 0.5 * (0.7 + 0.6 * fbm3(vP.xz / 0.9)), trB * 0.6);
              bc = mix(bc, rkB, zLb);
            }
          }
          // ganho medido por zona (foto/cena, tools/region_meas.py --esq), levado pro linear (^2): sem faixa clara no pé da esquerda
          float zB = smoothstep(260., 320., PY) * (1. - smoothstep(420., 470., PY));
          float zC = smoothstep(380., 440., PY) * (1. - smoothstep(330., 400., PX + (PY - 450.) * 0.3));
          float zD = smoothstep(380., 440., PX + (PY - 450.) * 0.3) * smoothstep(430., 480., PY);
          vec3 gz = mix(vec3(1.), vec3(0.77, 0.74, 0.76), zB);
          gz = mix(gz, vec3(0.47, 0.47, 0.40), zC);
          gz = mix(gz, vec3(0.94, 0.79, 0.74), zD);
          if (${Q.has('oldtelha') ? 'false' : 'true'}) gz *= mix(mix(vec3(1.42, 1.38, 1.35), vec3(1.75, 1.7, 1.75), smoothstep(200., 330., PY)), vec3(2.0, 2.0, 2.1), smoothstep(380., 440., PY));   // medido (A 31x37, B 32x42, C 32x44, D 58x69): a textura nova escureceu
          bc *= mix(vec3(1.), gz, wM);
          if (${Q.has('oldpenhasco') ? 'false' : 'true'}) {
            // penhasco acima do tálus (medido, quadro da CAM_FOTO): alto e esquerda 25 a 35% escuros; prateleira acima da faixa acesa
            // 30% clara; faixa acesa lisa (desvio 10 x 22): fraturas verticais irregulares e colunas só nela (?oldpenhasco volta)
            float zE = smoothstep(180., 215., PX) * (1. - smoothstep(355., 395., PX)) * smoothstep(300., 330., PY) * (1. - smoothstep(495., 530., PY));
            float zF = smoothstep(400., 435., PX) * (1. - smoothstep(610., 645., PX)) * smoothstep(395., 425., PY) * (1. - smoothstep(500., 525., PY));
            float zB = smoothstep(335., 375., PX) * (1. - smoothstep(630., 665., PX)) * smoothstep(500., 525., PY) * (1. - smoothstep(605., 630., PY));
            bc *= mix(vec3(1.), vec3(1.63, 1.55, 1.69), zE * wM);
            bc *= mix(vec3(1.), vec3(0.51, 0.60, 0.65), zF * wM);
            float fr = fbm3(vec2(hc / 5.5, (vP.y + dip) / 38.)) * 0.65 + fbm3(vec2(hc / 2.2, (vP.y + dip) / 14.)) * 0.35;
            float crack = smoothstep(0.38, 0.30, fr);                                   // rachaduras escuras verticais
            float col = smoothstep(0.45, 0.75, fbm3(vec2(hc / 11., (vP.y + dip) / 60.) + 7.));   // colunas claras aceso
            bc *= mix(vec3(1.), mix(vec3(1.25, 1.12, 1.05), vec3(1.95, 1.62, 1.3), col) * (1. - 0.6 * crack), zB * wM);   // v2: faixa acesa estava 25% escura (62 x 82 na foto)
          }
          if (${!Q.has('paredao3') ? 'false' : 'true'}) {
            // paredão v3 (jogo dos erros, "textura do paredão"; medido por zona, wall_zones.py): na foto, entre a encosta de cima e o
            // penhasco há uma faixa escura de mata (brilho 12 a 43, média 29,25,19) que cruza a emenda das duas malhas, e o penhasco
            // só começa 50 a 75 px abaixo da emenda. Aqui era a emenda reta com a fila de árvores e a cortina clara do penhasco logo
            // abaixo. A faixa de mata entra por cima da emenda, com bordas irregulares no mundo (?oldparedao3 volta). O penhasco
            // em si ficou como estava: colunas por textura girada, por estrutura procedural e por rocha escaneada em escala de
            // paredão foram testadas (v178, v179) e liam lisas ou como tábua/calçamento, piores que a cortina
            float xv3 = 1000. + (PX - 1000.) * 0.96, yv3 = 669.8 + (PY - 666.5) * 0.96;
            float nE3 = (fbm3(vec2(hc / 24., vP.y / 16.)) - 0.5) * 26. + (fbm3(vec2(hc / 5., vP.y / 4.)) - 0.5) * 9.;
            float yT3 = xv3 < 120. ? mix(275., 300., xv3 / 120.) : (xv3 < 200. ? mix(300., 362., (xv3 - 120.) / 80.) : (xv3 < 320. ? mix(362., 412., (xv3 - 200.) / 120.) : mix(412., 455., clamp((xv3 - 320.) / 240., 0., 1.))));
            float yC3 = xv3 < 160. ? mix(385., 386., xv3 / 160.) : (xv3 < 240. ? mix(386., 430., (xv3 - 160.) / 80.) : (xv3 < 320. ? mix(430., 460., (xv3 - 240.) / 80.) : (xv3 < 440. ? mix(460., 500., (xv3 - 320.) / 120.) : mix(500., 520., clamp((xv3 - 440.) / 120., 0., 1.)))));   // v2: à direita a mata desce até ~510 (sobrava faixa clara)
            float kT3 = smoothstep(yT3 - 10., yT3 + 10., yv3 + nE3);
            float kC3 = smoothstep(yC3 - 7., yC3 + 7., yv3 + nE3 * 0.6) * step(4.5, vData.y);
            float kB3 = kT3 * (1. - kC3) * wM;
            if (kB3 > 0.001) {
              // faixa de mata: copa de pinheiro escura em tufos alongados na vertical, pedra aparecendo entre eles (cobertura ~75%)
              vec3 lw3 = vec3(0.2126, 0.7152, 0.0722);
              float dC = dot(texture2D(tRock, vec2((vP.y + dip) / 34., hc / 24.)).rgb, lw3) / max(dot(texture2D(tRock, vec2(0.5), 12.).rgb, lw3), 0.02);
              float cp1 = fbm3(vec2(hc / 1.7, vP.y / 2.8)), cp2 = fbm3(vec2(hc, vP.y) / 9. + 5.1);
              float can3 = smoothstep(0.28, 0.5, cp1 * 0.55 + cp2 * 0.45);
              vec3 bandC = mix(vec3(44., 36., 29.) / 255. * (0.8 + 0.4 * clamp(dC, 0.5, 1.5)), vec3(16., 17., 11.) / 255. * (0.6 + 0.8 * cp1), can3);
              bc = mix(bc, invPost(bandC), kB3);
            }
            // faixa de estratos de cima (medido: foto 61,44,38, aqui 44,32,28): mais clara no miolo x 260-380, y 280-370 da vista
            float zS3 = smoothstep(240., 275., xv3 + nE3) * (1. - smoothstep(380., 405., xv3 + nE3)) * smoothstep(250., 285., yv3 + nE3) * (1. - smoothstep(yT3 - 15., yT3 + 2., yv3 + nE3)) * step(vData.y, 4.5);
            float zS4 = smoothstep(215., 250., xv3 + nE3) * (1. - smoothstep(390., 415., xv3 + nE3)) * smoothstep(170., 210., yv3 + nE3) * (1. - smoothstep(250., 285., yv3 + nE3)) * step(vData.y, 4.5);
            bc *= mix(1., pow(1.42, 2.2), zS3 * wM) * mix(1., pow(1.18, 2.2), zS4 * wM);
            if (${Q.has('oldfranja') ? 'false' : 'true'}) {
              // na foto há uma franja de abetos verde escuros (~39,36,29) ao longo da borda do paredão contra o céu, ~15 a 20 px, e uma
              // fileira deles num patamar na diagonal da faixa de estratos (vista 244,152 -> 406,291); aqui a borda era rocha nua
              float tE3 = clamp(yv3 / 10., 0., 33.99); int iE3 = int(floor(tE3)); float eW3 = mix(wallE[iE3], wallE[iE3 + 1], fract(tE3));
              float dE3 = eW3 - xv3 + (fbm3(vec2(hc / 6., vP.y / 6.)) - 0.5) * 10.;
              float fr3 = smoothstep(0., 3., dE3) * (1. - smoothstep(12., 22., dE3)) * (1. - smoothstep(320., 350., yv3));
              float lnD = yv3 - (152. + (xv3 - 244.) * 0.86) + (fbm3(vec2(hc / 9., 1.3)) - 0.5) * 9.;
              float rw3 = (1. - smoothstep(4., 10., abs(lnD))) * smoothstep(235., 255., xv3) * (1. - smoothstep(395., 415., xv3)) * smoothstep(0.25, 0.38, fbm3(vec2(PX / 22., 3.7)));   // falhas ao longo da fileira (pelo quadro: o ruído pelo mundo quase não variava ali)
              float tr3 = max(fr3, rw3) * step(vData.y, 4.5) * wM;
              if (tr3 > 0.001) {
                float cq = fbm3(vec2(hc / 1.5, vP.y / 2.5)), cq2 = fbm3(vec2(hc, vP.y) / 6. + 9.);
                float cv3 = max(smoothstep(0.3, 0.55, cq * 0.6 + cq2 * 0.4), rw3 * 0.6);   // fileira: copa mais fechada
                vec3 trC = mix(vec3(52., 44., 36.), vec3(26., 28., 18.) * (0.7 + 0.6 * cq), cv3) / 255.;
                bc = mix(bc, invPost(trC), tr3 * 0.92);
              }
            }
            // penhasco de baixo, parte da esquerda (wall_zones 'esq'): 16% claro e laranja (foto 41,31,25, aqui 49,35,29)
            float zE3 = kC3 * (1. - smoothstep(215., 260., xv3 + nE3)) * wM;
            bc *= mix(vec3(1.), vec3(0.68, 0.77, 0.72), zE3);
          }
        }
      }
      if (${Q.has('oldcanto') ? 'false' : 'true'} && vData.y > 3.5 && vData.y < 8.4 && Xf > 560. && Xf < 800. && Yf > 520. && Yf < 800.) {
        // pedido ("arruma só isso aqui", "tá falso isso"): à direita do leque da esquerda, entre o fim do penhasco e a mata, a rampa do
        // pé do penhasco aparecia como pedregulho cinza do alto até a água, com a borda vertical reta do penhasco e uma lasca laranja
        // dele na beira (x ~727). Na foto ali é mata fechada até a faixa baixa de pedregulho da beira (linha (640,715) (744,735)
        // (830,740) da vista), e a mata sobe colada no pé do penhasco em diagonal (?oldcanto volta)
        float xvK = 1000. + (Xf - 1000.) * 0.96, yvK = 669.8 + (Yf - 666.5) * 0.96;
        float nK = (fbm3(vP.xz / 6.) - 0.5) * 14. + (fbm3(vP.xz / 2.) - 0.5) * 5.;
        // v4 (pedido: "isso precisa de ajuste"): a copa pelo vP.xz esticava na parede quase vertical e virava uma coluna listrada;
        // agora a textura vai pela própria face (ao longo do paredão x altura). No penhasco são tufos de abeto com a rocha aparecendo
        // entre eles (foto); na rampa, mata fechada. A borda de baixo termina em pontas irregulares, sem pente
        float hcK = vP.x * 0.83 + vP.z * 0.56; vec2 fcK = vec2(hcK, vP.y);
        float cA = fbm3(fcK / vec2(2.2, 3.6)), cB = fbm3(fcK / 8. + 3.3), cM = cA * 0.6 + cB * 0.4;
        float clK = smoothstep(0.32, 0.52, cM);
        float isCl = 1. - smoothstep(6., 6.6, vData.y);                                     // 1 = penhasco, 0 = rampa
        float xLK = (yvK < 640. ? 615. : mix(615., 592., smoothstep(640., 700., yvK))) + (fbm3(vec2(vP.y / 9., 2.1)) - 0.5) * 16.;
        float lnK = xvK < 744. ? mix(715., 735., (xvK - 640.) / 104.) : mix(735., 740., (xvK - 744.) / 86.);
        float lnT = lnK + (fbm3(vec2(hcK / 1.3, 0.7)) - 0.5) * 12. + nK * 0.4;           // pontas das árvores no pedregulho
        // v5 (pedido: "tirar o risco laranja e ajustar esse tipo de mato que parece que não faz parte dali, tá com cor diferente"):
        // o mato pintado saía oliva-marrom (36,34,26) e as árvores do lado são verde-acinzentadas (37,39,32); e na foto o trecho de
        // cima do penhasco ainda é rocha (53,41,35). O penhasco fica sem mato; só a rampa entre ele e as árvores vira mata, na cor
        // medida das árvores, com variação macia (sem tufo pontilhado). A ponta do penhasco na beira (lasca laranja, x > 690) entra
        float zoneK = smoothstep(xLK - 8., xLK + 8., xvK + nK) * smoothstep(535., 560., yvK + nK);
        float clStay = isCl * (1. - smoothstep(680., 695., xvK));
        float kM = zoneK * (1. - smoothstep(lnT - 3., lnT + 2., yvK)) * (1. - clStay);
        float kP = smoothstep(lnT - 3., lnT + 2., yvK) * smoothstep(600., 625., xvK + nK) * (1. - smoothstep(760., 790., xvK));
        vec3 canK = vec3(37., 39., 32.) / 255. * (0.8 + 0.4 * fbm3(fcK / vec2(1.6, 3.2))) * (0.9 + 0.2 * fbm3(fcK / 8. + 1.7));
        vec3 rubK = vec3(77., 64., 56.) / 255. * (0.7 + 0.6 * fbm3(vP.xz / 1.1)) * (0.85 + 0.3 * fbm3(vP.xz / 4.));
        bc = mix(bc, invPost(canK), kM * 0.95);
        bc = mix(bc, invPost(rubK), kP);
      }
      if (${!Q.has('talus3') ? 'false' : 'true'} && vData.y > 7.5 && Xf < 700. && Yf > 480.) {
        // tálus da esquerda (medido com meas_boxes em 6 caixas): a areia da foto é mais quente e um pouco mais clara (128,92,77 e
        // 134,97,83 na foto, 117,89,79 e 115,88,78 aqui). Fora da encosta da frente (linha medida, posição original) (?oldtalus3 volta)
        float xvA = 1000. + (Xf - 1000.) * 0.96, yvA = 669.8 + (Yf - 666.5) * 0.96;
        float LsA = xvA < 188. ? mix(611., 653., (xvA - 100.) / 88.) : (xvA < 223. ? mix(653., 660., (xvA - 188.) / 35.) : 660. + (xvA - 223.) * 0.9);
        float zA = smoothstep(0., 10., LsA - yvA) * smoothstep(200., 240., xvA) * (1. - smoothstep(600., 660., xvA)) * (1. - smoothstep(700., 740., yvA));
        bc *= mix(vec3(1.), vec3(1.30, 1.13, 1.02), zA);
      }
      if (${Q.has('oldpedregulho') ? 'false' : 'true'} && Xf > 400. && Xf < 730. && Yf > 590. && Yf < 780. && vData.y < 10.) {
        // pedido ("arrume isso", borda direita do leque perto da água): a média de cor já bate com a foto (90,70,62 x 89,70,60), mas a
        // foto é pedregulho (desvio 31) e aqui era liso (18), com linha reta na borda da peça. Pedras de 1 a 3 m com sombra e contraste
        // médio, no chão da faixa e nos últimos ~18 px do leque, sem mudar a média
        float edP = vData.y > 8. ? (vData.x - 2.) * 40. : 0.;
        float zR = (vData.y > 8. ? 1. - smoothstep(6., 22., edP + (fbm3(vP.xz / 3.) - 0.5) * 10.) : 1.) * smoothstep(400., 440., Xf) * (1. - smoothstep(700., 730., Xf)) * smoothstep(590., 620., Yf);
        if (zR > 0.001) {
          vec2 shR = -normalize(vec2(0.55, -0.72));
          vec3 sR = stoneF(vP.xz, 2.6, 0.5, 1.5, shR, 0.8), sR2 = stoneF(vP.xz + 9.1, 1.3, 0.25, 0.7, shR, 0.7);
          float rubK = (0.75 + 0.5 * fbm3(vP.xz / 1.4)) * (0.85 + 0.3 * fbm3(vP.xz / 5.)) * mix(1., 0.45, max(sR.z * (1. - sR.x), sR2.z * (1. - sR2.x) * 0.7));   // v2: mais contraste (ainda lia liso)
          rubK = mix(rubK, rubK * sR.y * 1.1, sR.x); rubK = mix(rubK, rubK * sR2.y, sR2.x * (1. - sR.x));
          bc = mix(bc, bc * rubK / 0.93, zR);
        }
      }
      if (${Q.has('oldcanto') ? 'false' : 'true'} && Xf > 580. && Xf < 830. && Yf > 690. && Yf < 800.) {
        // pedido ("tá parecendo mancha esse marrom também"): a faixa de pedregulho da beira era um bloco marrom liso (79,64,56,
        // desvio 13) que acabava numa linha reta tracejada contra a faixa cinza da margem, outra malha e outro tom. Na foto é uma faixa
        // só: pedregulho cinza amarronzado com pedras (93,74,66, desvio 18) e, à direita, beira com mato baixo oliva (56,52,37).
        // Atravessa as malhas (todos os tipos), menos o corpo do leque da esquerda
        float xvS = 1000. + (Xf - 1000.) * 0.96, yvS = 669.8 + (Yf - 666.5) * 0.96;
        float nS = (fbm3(vP.xz / 6.) - 0.5) * 14. + (fbm3(vP.xz / 2.) - 0.5) * 5.;
        float lnS = (xvS < 744. ? mix(715., 735., (xvS - 640.) / 104.) : mix(735., 740., (xvS - 744.) / 86.)) + (fbm3(vec2((vP.x * 0.83 + vP.z * 0.56) / 1.3, 0.7)) - 0.5) * 12. + nS * 0.4;
        float fanE = 600. + (yvS - 707.) * 1.75;
        float notFan = vData.y > 8.4 ? smoothstep(fanE - 4., fanE + 6., xvS + nS * 0.5) : 1.;
        float zS = smoothstep(lnS - 3., lnS + 2., yvS) * smoothstep(600., 625., xvS + nS) * (1. - smoothstep(785., 815., xvS)) * notFan;
        if (zS > 0.001) {
          vec2 shS = -normalize(vec2(0.55, -0.72));
          vec3 s1 = stoneF(vP.xz, 2.6, 0.5, 1.5, shS, 0.8), s2 = stoneF(vP.xz + 9.1, 1.3, 0.25, 0.7, shS, 0.7);
          float txS = (0.75 + 0.5 * fbm3(vP.xz / 1.4)) * (0.85 + 0.3 * fbm3(vP.xz / 5.)) * mix(1., 0.5, max(s1.z * (1. - s1.x), s2.z * (1. - s2.x) * 0.7));
          txS = mix(txS, txS * s1.y * 1.15, s1.x); txS = mix(txS, txS * s2.y * 1.1, s2.x * (1. - s1.x));
          vec3 rbS = mix(vec3(93., 74., 66.), vec3(58., 54., 40.), smoothstep(725., 765., xvS + nS)) / 255.;
          bc = mix(bc, invPost(rbS * txS), zS);
        }
      }
      if (${Q.has('oldtopomata') ? 'false' : 'true'} && vData.y > 8. && Xf > 1150. && Xf < 1520. && Yf > 620. && Yf < 720.) {
        // a mata baixou até a linha da foto e descobriu o pé do leque do meio: liso e rosado (149,111,97, desvio 8); na foto é cascalho
        // mais escuro e pedregoso (115 a 146, 90 a 111, 80 a 98, desvio ~30). Ganho medido no linear + pedras com sombra
        float zQ = smoothstep(1150., 1190., Xf) * (1. - smoothstep(1480., 1520., Xf)) * smoothstep(620., 640., Yf);
        vec2 shQ = -normalize(vec2(0.55, -0.72));
        vec3 sQ = stoneF(vP.xz, 2.2, 0.45, 1.3, shQ, 0.8), sQ2 = stoneF(vP.xz + 5.3, 1.1, 0.25, 0.7, shQ, 0.7);
        float kQ = (0.72 + 0.56 * fbm3(vP.xz / 1.6)) * (0.85 + 0.3 * fbm3(vP.xz / 6.)) * mix(1., 0.45, max(sQ.z * (1. - sQ.x), sQ2.z * (1. - sQ2.x) * 0.7));
        kQ = mix(kQ, kQ * sQ.y * 1.15, sQ.x);
        bc = mix(bc, bc * vec3(0.68, 0.76, 0.76) * kQ / 0.95, zQ);
      }
      if (${Q.has('oldfaceacesa') ? 'false' : 'true'} && useBake2 > 0.5 && Rh > 2200.) {
        // jogo dos erros (piores blocos 1440-1560 x 400-440): a face grande do centro-direita está acesa na foto (187,121,108) e aqui
        // escura (119,85,81); grade de brilho foto/cena 1,5 a 2,6 numa elipse de ~330 x 170 px. Ganho medido, sem a neve (?oldfaceacesa)
        float eA = length(vec2((Xf - 1490.) / 175., (Yf - 428.) / 88.));
        float lA = dot(bc, vec3(0.2126, 0.7152, 0.0722));
        float wA = (1. - smoothstep(0.45, 1.0, eA + (fbm3(vec2(Xf / 40., Yf / 40.)) - 0.5) * 0.25)) * (1. - smoothstep(0.3, 0.45, lA));
        bc *= mix(vec3(1.), vec3(2.0, 1.72, 1.52), wA);
      }
      if (${Q.has('oldcume') || Q.has('oldcrista') ? 'false' : 'true'} && Rh > 2200.) {
        // cume do pico escuro (esticado pela crista): na foto o alto é rocha e neve acesas em laranja pelo pôr do sol (226,132,89),
        // numa faixa de ~10 a 25 px; aqui ficava cinza malva. Distância até o topo novo pelas mesmas tabelas do vertex shader
        float xvC = 1000. + (Xf - 1000.) * 0.96, yvC = 669.8 + (Yf - 666.5) * 0.96, tC = (xvC - 1460.) / 10.;
        if (tC > 0. && tC < 33.) {
          int iC = int(floor(tC)); float fC = fract(tC);
          float rC = mix(silR[iC], silR[iC + 1], fC), ytC = mix(silT[iC], silT[iC + 1], fC);
          float dep = (yvC - rC * (1. - smoothstep(0., 220., yvC - ytC))) - (ytC - rC);
          float kC = smoothstep(1530., 1560., xvC) * (1. - smoothstep(1645., 1672., xvC)) * (1. - smoothstep(5., 24., dep + (fbm3(vec2(Xf / 6., Yf / 5.)) - 0.5) * 14.));
          // pedido ("esse laranja no mar não tem"): no reflexo a ponta do pico fica escura como na foto; o laranja só na vista
          // (passe do reflexo = clipY -0,5; ?oldreflcume volta)
          bc *= mix(vec3(1.), vec3(1.9, 1.05, 0.55), kC * ${Q.has('oldreflcume') ? '1.' : 'step(clipY, -1e8)'});
          if (${Q.has('oldreflcume') ? 'false' : 'true'} && clipY > -1e8) {   // v2: no reflexo a ponta ainda puxava pro vermelho do render
            float kRf = smoothstep(1520., 1550., xvC) * (1. - smoothstep(1660., 1690., xvC)) * (1. - smoothstep(20., 60., dep));
            float lRf = dot(bc, vec3(0.2126, 0.7152, 0.0722));
            // v4 (pedido: "tá estourado o contraste, o brilho"): a v3 deixava a ponta azul-marinho escura (49,60,79 na tela do
            // usuário) contra o salmão da nuvem; na foto a ponta refletida é cinza-rosada clara (124,94,86). Mesmo brilho do render,
            // só sem o laranja, puxando pro rosado
            bc = mix(bc, vec3(lRf) * vec3(1.1, 0.96, 0.92) * 1.05, kRf * 0.85);
          }
        }
      }
      if (${Q.has('clareza') ? 'true' : 'false'} && useBake2 > 0.5 && Rh > 2200. && Yf < 720.) {   // testado: ΔE cai 0,4 mas a rocha fica borrada (desligado)
        // jogo dos erros (montanhas): média e desvio por face já batem com a foto, mas a nossa rocha tem detalhe miúdo demais
        // (furinhos, tubo de órgão) e pouca forma grande (face acesa x sombra funda). Tira parte do detalhe fino e aumenta o
        // contraste da escala grande, só no brilho (?oldclareza volta; ?clf= e ?clb= pra testar)
        vec3 lwC = vec3(0.2126, 0.7152, 0.0722);
        float l0 = dot(texture2D(tBake2, buvS, -0.7).rgb, lwC), l1 = dot(texture2D(tBake2, buvS, 1.8).rgb, lwC), l2 = dot(texture2D(tBake2, buvS, 4.6).rgb, lwC);
        float fineK = ${Q.has('clf') ? parseFloat(Q.get('clf')).toFixed(3) : '0.35'}, bigK = ${Q.has('clb') ? parseFloat(Q.get('clb')).toFixed(3) : '0.4'};
        float kC = pow(max(l1, 0.02) / max(l0, 0.02), 2.2 * fineK) * pow(max(l1, 0.02) / max(l2, 0.02), 2.2 * bigK);
        bc *= clamp(kC, 0.45, 2.0);
      }
      if (${Q.has('oldliso') ? 'false' : 'true'} && useBake2 > 0.5 && Rh > 2150.) {
        // jogo dos erros 18 (furinhos pretos): na sombra à direita do corredor a foto é rocha marrom macia (desvio 16) e aqui granulada
        // (desvio 24, pontos pretos do render). Tira ~45% do detalhe fino só ali, pelo brilho (média do mip mais alto do próprio bake)
        float zLs = smoothstep(960., 1000., Xf) * (1. - smoothstep(1200., 1245., Xf)) * smoothstep(355., 385., Yf) * (1. - smoothstep(515., 545., Yf));
        if (zLs > 0.001) {
          vec3 lwL = vec3(0.2126, 0.7152, 0.0722);
          float a0 = dot(texture2D(tBake2, buvS, -0.7).rgb, lwL), a1 = dot(texture2D(tBake2, buvS, 2.2).rgb, lwL);
          float sL = smoothstep(0.62, 0.5, a0);   // neve fica nítida
          bc *= mix(1., clamp(pow(max(a1, 0.02) / max(a0, 0.02), 2.2 * 0.45), 0.6, 1.8), zLs * sL);
        }
      }
      if (${Q.has('oldmacico3') ? 'false' : 'true'} && useBake2 > 0.5 && Rh > 2150.) {
        // maciço da esquerda (jogo dos erros 17): medido em 9 caixas (v173); o alto da esquerda e a faixa de baixo ~20% claros e
        // rosados (foto 102 a 118 x 124 a 141), o meio bate. Ganho no linear por faixa, e a faixa de baixo mais lisa (desvio 15 a 18
        // na foto, 26 a 31 aqui) (?oldmacico3)
        float xvM = 1000. + (Xf - 1000.) * 0.96, yvM = 669.8 + (Yf - 666.5) * 0.96;
        float zM = smoothstep(470., 500., xvM) * (1. - smoothstep(820., 850., xvM)) * smoothstep(205., 225., yvM) * (1. - smoothstep(455., 480., yvM));
        if (zM > 0.001) {
          vec3 gTop = mix(mix(vec3(0.68, 0.67, 0.73), vec3(0.84, 0.81, 0.86), smoothstep(585., 615., xvM)), vec3(1.), smoothstep(690., 710., xvM));
          vec3 gM3 = mix(gTop, vec3(0.97, 0.95, 1.0), smoothstep(280., 300., yvM));
          gM3 = mix(gM3, vec3(0.67, 0.68, 0.76), smoothstep(365., 385., yvM));
          bc *= mix(vec3(1.), gM3, zM);
          vec3 lwM = vec3(0.2126, 0.7152, 0.0722);
          float b0 = dot(texture2D(tBake2, buvS, -0.7).rgb, lwM), b1 = dot(texture2D(tBake2, buvS, 2.2).rgb, lwM);
          bc *= mix(1., clamp(pow(max(b1, 0.02) / max(b0, 0.02), 2.2 * 0.4), 0.6, 1.8), zM * smoothstep(360., 390., yvM) * smoothstep(0.62, 0.5, b0));
        }
      }
      if (${Q.has('olddireita') ? 'false' : 'true'} && Rh > 2150.) {
        // alto das montanhas da direita (vista 1250-1650 x 200-420, distribuição de brilho pela máscara): mesma forma de histograma,
        // mas ~13% escuro (foto 173,107,94, aqui 152,94,82). Ganho medido no linear; a neve volta ao tom dela logo abaixo (?olddireita)
        float xvR = 1000. + (Xf - 1000.) * 0.96, yvR = 669.8 + (Yf - 666.5) * 0.96;
        float zR2 = smoothstep(1240., 1290., xvR) * (1. - smoothstep(1620., 1670., xvR)) * (1. - smoothstep(400., 440., yvR + (fbm3(vec2(Xf / 30., Yf / 30.)) - 0.5) * 30.));
        bc *= mix(vec3(1.), vec3(1.33, 1.33, 1.35), zR2 * (1. - smoothstep(0.3, 0.55, dot(bc, vec3(0.2126, 0.7152, 0.0722)))));   // v2: o que já é claro não sobe (1360-1400 x 360-400 passava da foto)
        // faixa de sombra do pico da direita (grade de 50 px, vista 1600-1900 x 440-530): na foto rocha malva em sombra (103,69,71),
        // aqui laranja e clara (138,79,71) em toda a faixa
        float zR3 = smoothstep(1630., 1670., xvR) * (1. - smoothstep(1900., 1940., xvR)) * smoothstep(425., 445., yvR + (fbm3(vec2(Xf / 25., Yf / 25.)) - 0.5) * 20.) * (1. - smoothstep(525., 545., yvR));
        bc *= mix(vec3(1.), vec3(0.62, 0.74, 0.93), zR3);
        // face acesa do centro-direita (grade de 40 px): na foto a luz fica em x 1240-1360, y 425-505 (163 a 177 de vermelho), aqui
        // ela está ~70 px à direita (x 1380-1420 claro demais, 216 x 185) e a face da foto ficou escura (117 a 138)
        float eL = length(vec2((xvR - 1310.) / 86., (yvR - 470.) / 50.)) + (fbm3(vec2(Xf / 18., Yf / 18.)) - 0.5) * 0.35;   // v2: pega 1320-1360 x 480-520
        float eD = length(vec2((xvR - 1405.) / 30., (yvR - 432.) / 52.)) + (fbm3(vec2(Xf / 18., Yf / 18.) + 3.) - 0.5) * 0.35;
        bc *= mix(vec3(1.), vec3(1.6, 1.55, 1.6), 1. - smoothstep(0.6, 1.0, eL));
        bc *= mix(vec3(1.), vec3(0.78, 0.8, 0.82), 1. - smoothstep(0.6, 1.0, eD));
      }
      if (${Q.has('oldombro') ? 'false' : 'true'} && Rh > 2150.) {
        // ombro direito do pico da direita (meas_boxes): na foto o laranja ali é mais apagado (182,90,52) e aqui saturado (227,94,30);
        // o cume da esquerda bate (241,113,22 x 244,96,10). Só no que é laranja aceso, sem mexer na rocha e na neve (?oldombro volta)
        float xvO = 1000. + (Xf - 1000.) * 0.96, yvO = 669.8 + (Yf - 666.5) * 0.96;
        float sO = smoothstep(1875., 1910., xvO + (fbm3(vec2(Xf / 20., Yf / 20.)) - 0.5) * 30.);
        float zO = (1. - smoothstep(365., 395., yvO)) * smoothstep(280., 300., yvO) * smoothstep(1750., 1775., xvO);
        vec3 dO = pow(max(bc, vec3(0.)), vec3(1. / 2.2)); float orO = smoothstep(0.6, 0.8, (dO.r - dO.b) / max(dO.r, 1e-3));
        // v2: no cume o laranja da foto é mais amarelo (236,113,27 x 219,79,27 aqui); no ombro, ainda saturado (208,90,42 x 182,90,52)
        bc *= mix(vec3(1.), mix(vec3(1.18, 1.75, 1.), vec3(0.46, 0.9, 3.4), sO), zO * orO);
        if (${Q.has('oldreflfogo') ? 'false' : 'true'} && clipY > -1e8) {
          // pedido ("isso tá estranho, tá muito forte"): no reflexo o laranja aceso do pico da direita virava um brilho contínuo com
          // cara de fogo; na foto ele aparece quebrado em pontinhos dourados pela ondulação e menos saturado. Só no passe do reflexo
          float zRf = smoothstep(1740., 1770., xvO) * (1. - smoothstep(380., 410., yvO)) * smoothstep(270., 290., yvO);
          float lRf2 = dot(bc, vec3(0.2126, 0.7152, 0.0722));
          float flk = 0.8 + 0.45 * smoothstep(0.4, 0.65, fbm3(vec2(Xf / 6.5, Yf / 1.8) + 2.7));          // manchas da ondulação, 6-10 px (v7: menos contraste; de longe as manchas fortes viravam um borrão estourado)
          // v3: a v1 apagava o laranja que a foto tem, a v2 ficou marrom e apagada; na foto são pontinhos dourados (laranja puxando
          // pro amarelo) bem contrastados, não um brilho vermelho contínuo
          // v7 (pedido: "tá muito mais saturado do que a referência"; no print do usuário 47% de laranja forte puxando pro vermelho,
          // 181,69,59, saturação mediana 0,50; na foto 19%, 157,99,77, 0,18): dourado apagado, sem o verde-amarelado
          bc = mix(bc, mix(bc, vec3(lRf2) * vec3(1.15, 0.97, 0.85), 0.35) * 0.9 * flk, zRf * orO);
        }
      }
      // neve das montanhas (snow_trace: contorno e tom da foto por zona): os ganhos de zona da rocha (sombra entre maciços etc.) a
      // deixavam cinza azulada; aqui volta o tom do bake (?oldneveprot). O corredor tem neve própria e fica fora
      if (${Q.has('oldneveprot') ? 'false' : 'true'} && Rh > 2150. && snowW > 0.001 && !(Xf > 790. && Xf < 975. && Yf > 285.)) bc = mix(bc, snowCol, snowW);
      if (${Q.has('oldpingo') ? 'false' : 'true'} && Rh > 2150.) {
        // pedido ("o que é isso", "parece pingo de tinta"): as manchas de neve do paredão cinza atrás da mata (vista ~740-800 x
        // 510-600) eram brancas chapadas de contorno liso. Na foto a neve está no mesmo lugar, mas com borda recortada, sombra por
        // dentro e a rocha aparecendo nas beiradas (?oldpingo volta)
        float xvN = 1000. + (Xf - 1000.) * 0.96, yvN = 669.8 + (Yf - 666.5) * 0.96;
        // pedido ("sim, estende"): na foto essa neve fica na beira do leque de cascalho rosado (161,120,111, liso), entre a rocha escura
        // e a mata; aqui o leque começava ~50 px mais à direita e a neve ficava solta na rocha cinza (115,87,85). Leque estendido até
        // a borda da foto: esquerda (752,546)-(760,574), alto ~526-532, embaixo o topo da mata (758,574)-(812,608); para antes do pé
        // do corredor de neve (?oldleque2 volta)
        float nF = (fbm3(vec2(Xf, Yf) / 8.) - 0.5) * 12. + (fbm3(vec2(Xf, Yf) / 3.) - 0.5) * 5.;
        float lftF = 752. + (yvN - 546.) * 0.3, topF = 526. + (xvN - 776.) * 0.07, botF = 574. + (xvN - 758.) * 0.63;
        float zF = ${Q.has('oldleque2') ? '0.' : '1.'} * smoothstep(lftF - 4., lftF + 4., xvN + nF) * smoothstep(topF - 6., topF + 6., yvN + nF)
                 * (1. - smoothstep(botF - 4., botF + 4., yvN + nF * 0.5)) * (1. - smoothstep(815., 838., xvN + nF));
        vec3 pinkF = invPost(vec3(162., 122., 112.) / 255. * (0.93 + 0.1 * fbm3(vec2(Xf / 6., Yf / 2.))) * (0.96 + 0.08 * fbm3(vec2(Xf, Yf) / 1.3)));
        bc = mix(bc, pinkF, zF * 0.92 * (1. - smoothstep(0.02, 0.2, snowW)));
        float zN = smoothstep(700., 730., xvN) * (1. - smoothstep(880., 910., xvN)) * smoothstep(480., 500., yvN) * (1. - smoothstep(615., 635., yvN));
        if (zN > 0.001 && snowW > 0.001) {
          // v2 (a v1 só mexia na beirada fina): neve do render borrada = distância até a borda; o recorte com ruído entra uns px
          // mancha adentro, e o lado de baixo/direita fica em sombra (vizinho de cima/esquerda com mais neve = este lado é a sombra)
          vec3 lwN = vec3(0.2126, 0.7152, 0.0722); vec2 pxN = vec2(1. / (3250. * bakeTH), 1. / (3250. * bakeTV));
          float sB = smoothstep(0.45, 0.72, dot(texture2D(tBake2, buvS, 2.5).rgb, lwN));
          float sBo = smoothstep(0.45, 0.72, dot(texture2D(tBake2, buvS + vec2(-2., 2.) * pxN, 2.5).rgb, lwN));
          // v3 ("o nosso está sólido, não parece que está na pedra"): sem anel escuro (a erosão pela neve borrada cortava as manchas
          // pequenas por dentro). Borda pela neve levemente borrada (mais macia) com ruído; por dentro a camada da rocha aparece de leve
          // em estrias (neve assentada nas camadas), lado oposto à luz em sombra
          float sS = smoothstep(0.45, 0.72, dot(texture2D(tBake2, buvS, 1.2).rgb, lwN));
          float nN = fbm3(vec2(Xf, Yf) / 3.) - 0.5;
          float wN = smoothstep(0.2, 0.75, sS + nN * 0.45) * smoothstep(0.05, 0.4, sS);
          float shN = clamp(0.55 + (sBo - sB) * 1.5, 0., 1.);
          float stN = fbm3(vec2(Xf / 5., Yf / 1.6) + 3.1);                                   // estrias das camadas da rocha
          vec3 rockN = mix(invPost(vec3(100., 74., 70.) / 255. * (0.75 + 0.5 * fbm3(vec2(Xf, Yf) / 2.))), pinkF, zF);   // borda recortada mostra o cascalho onde o leque passa
          vec3 snN = snowCol * mix(0.72, 1.02, shN) * (0.8 + 0.3 * stN) * vec3(0.97, 0.97, 1.0);
          snN = mix(snN, rockN * 1.6, smoothstep(0.62, 0.78, stN) * 0.35);
          bc = mix(bc, mix(rockN, snN, wN * 0.95), zN * smoothstep(0.02, 0.15, max(sS, snowW)));
        }
      }
      if (${Q.has('dbgrh') ? 'true' : 'false'}) { gl_FragColor = vec4(step(2150., Rh), vData.y / 12., 0., 1.); return; }   // depuração: ramo de longe (vermelho) e tipo de peça (verde)
      if (${Q.has('dbgy') ? 'true' : 'false'} && Xf > 1150. && Yf > 700.) { gl_FragColor = vec4(clamp(vP.y / 25., 0., 1.), step(2150., Rh), step(4500., Rh), 1.); return; }   // depuração: altura acima da água
      if (${Q.has('oldbeira2') ? 'false' : 'true'} && Rh < 4500. && vP.y < 5.5 && vP.y > -1. && Xf > 1150. && Yf > 735. && Yf < 920.) {   // v3: a margem da direita passa de 2,15 km (ramo de longe)
        // revisão ("superfície e margem da água: o encontro da água com a margem pode melhorar"): na margem da mata da direita a
        // borda da máscara de chão de mata (baixa resolução) virava uma faixa cinza em degraus. Na foto: chão escuro molhado, mato
        // baixo e pedras/troncos claros rosados soltos na linha d'água (~150,120,105). Faixa pela altura acima da água, borda com
        // ruído, pedras em grupos (?oldbeira2 volta)
        float nW = fbm3(vP.xz / 4.) - 0.5, hW = vP.y + nW * 1.2;
        float zMr = smoothstep(1150., 1190., Xf) * smoothstep(735., 750., Yf);
        float bandW = (1. - smoothstep(2.6, 4.6, hW)) * zMr;   // v2: o barranco cinza ia até ~4 m acima da água
        if (${Q.has('dbgb') ? 'true' : 'false'}) { gl_FragColor = vec4(bandW, 0., 1., 1.); return; }
        if (bandW > 0.001) {
          vec2 shW = -normalize(vec2(0.55, -0.72));
          vec3 stW = stoneF(vP.xz, 1.6, 0.3, 0.9, shW, 0.6);
          float grassW = smoothstep(0.45, 0.65, fbm3(vP.xz / 2.2 + 3.));
          vec3 grdW, stcW; float clW;
          if (${Q.has('oldbeira3') ? 'true' : 'false'}) {
            grdW = vec3(0.022, 0.026, 0.016) * (0.7 + 0.6 * fbm3(vP.xz / 1.1));
            grdW = mix(grdW, vec3(0.035, 0.046, 0.02) * (0.8 + 0.4 * fbm3(vP.xz / 0.8)), grassW * 0.7);
            stcW = vec3(0.24, 0.18, 0.14) * (0.75 + 0.5 * fbm3(vP.xz / 0.7)) * stW.y;
            clW = smoothstep(0.35, 0.6, fbm3(vP.xz / 6. + 1.));
          } else {
            // v4: a faixa lia como uma calçada cinza pontilhada (pedra demais, cor clara). Na foto: chão escuro molhado, mato
            // baixo subindo pro pé da mata e pedras/troncos claros só na linha d'água, em grupos soltos. Cores alvo pelo inverso do pós
            grdW = invPost(vec3(30., 34., 22.) / 255.) * (0.7 + 0.6 * fbm3(vP.xz / 1.1));
            grdW = mix(grdW, invPost(vec3(40., 48., 26.) / 255.) * (0.8 + 0.4 * fbm3(vP.xz / 0.8)), grassW * 0.6);
            float shrW = smoothstep(0.7, 1.9, hW + (fbm3(vP.xz / 1.5 + 5.) - 0.5) * 1.6);   // mato baixo escuro: esconde o degrau no pé das árvores
            vec3 shrC = mix(invPost(vec3(20., 26., 17.) / 255.), invPost(vec3(58., 72., 38.) / 255.), smoothstep(0.55, 0.68, fbm3(vP.xz / 5. + 7.)) * 0.8);   // v5: moitas verdes mais claras em manchas (foto)
            grdW = mix(grdW, shrC * (0.7 + 0.6 * fbm3(vP.xz / 0.6 + 2.)), shrW);
            // v6: na linha d'água, troncos e pedras claros alongados ao longo da margem (v5 pontilhava contas miúdas). Formas no
            // quadro da câmera de referência (presas ao mundo), deitadas na inclinação da margem (~7 graus), sombra embaixo
            stW = mix(stW, stoneF(vec2(Xf / 9., (Yf - 0.126 * Xf) / 1.3), 2.4, 0.6, 1.2, vec2(0., 0.45), 0.8), 1. - smoothstep(0.7, 1.6, hW));
            stcW = invPost(vec3(158., 130., 114.) / 255.) * (0.75 + 0.5 * fbm3(vP.xz / 0.7)) * min(stW.y, 1.15);
            clW = smoothstep(0.42, 0.58, fbm3(vP.xz / 9. + 1.)) * (1. - smoothstep(0.6, 1.4, hW));
          }
          vec3 shoreW = mix(grdW, stcW, stW.x * clW);
          shoreW *= mix(1., 0.55, stW.z * (1. - stW.x));
          shoreW *= mix(1., 0.75, 1. - smoothstep(0.2, 0.9, hW));                    // logo acima da água: molhado, mais escuro
          bc = mix(bc, shoreW, bandW * 0.95);
        }
      }
      if (${Q.has('rawmtn') ? 'true' : 'false'} && useBake2 > 0.5 && Rh > 2150.) bc = invPost(min(texture2D(tBake2, buvS, -0.7).rgb, vec3(0.995)));   // depuração: bake cru
      if (${Q.has('mtnmask') ? 'true' : 'false'} && Rh > 2200. && Yf < 720.) { gl_FragColor = vec4(1., 0., 1., 1.); return; }
      gl_FragColor = vec4(bc, 1.); return;
    }
    vec3 P = vP; vec3 N = normalize(vN);
    vec3 w = pow(abs(N), vec3(4.)); w /= (w.x+w.y+w.z);
    float dist = length(P - cameraPosition);
    float fade = 1. - smoothstep(2500., 9000., dist);
    // azimute relativo à câmera de referência separa maciço central e Dez Picos
    vec3 rp = P - camRef; float az = atan(rp.x, -rp.z) - yaw; az = atan(sin(az), cos(az));
    // detalhe de rocha em duas escalas
    vec3 r1 = tri(tRock, P, w, 1./38.) / mRock;
    vec3 r2 = tri(tRock2, P, w, 1./240.) / mRock2;
    vec3 rd = mix(vec3(1.), r1, detail*mix(0.45,1.,fade)) * mix(vec3(1.), r2, 0.35);
    // estratos horizontais com dobra suave
    float warp = fbm3(P.xz/420.)*26.;
    float band = fbm3(vec2((P.y + warp)*0.21, 3.7));
    float band2 = vnoise(vec2((P.y + warp)*0.9, 1.3));
    float wallM = smoothstep(0.3, 0.7, vData.y);
    float strat = 1. + strata*((band-0.5)*1.4 + (band2-0.5)*0.5) * wallM;
    vec3 rockCol = mix(cCentral, cTen, smoothstep(0.08, 0.2, az));
    vec3 col = rockCol * rd * strat;
    // paredão da esquerda: escuro com faixas
    vec3 dk = tri(tDark, P, w, 1./30.) / mDark;
    float wb = smoothstep(0.55, 0.75, band) ;
    vec3 wall = mix(cWall, cWallBand, wb*0.8 + (band2-0.5)*0.3) * mix(vec3(1.), dk, 0.6) * mix(vec3(1.), r1, 0.4);
    col = mix(col, wall, smoothstep(0.3, 0.7, vData.y));
    // talus
    vec3 sc = tri(tScree, P, w, 1./55.) / mScree;
    float tn = fbm(P.xz/90.);
    float tal = smoothstep(0.25, 0.65, vCol.a + (tn-0.5)*0.5);
    vec3 talC = mix(cTalC, cTalL, smoothstep(-0.12, -0.2, az)) * mix(vec3(1.), sc, 0.55) * (0.9 + 0.2*tn);
    col = mix(col, talC, tal);
    // verde: chão de mata e musgo
    vec3 gr = tri(tGround, P, w, 1./40.) / mGround;
    float g = smoothstep(0.15, 0.5, vData.x + (tn-0.5)*0.3);
    vec3 grC = mix(cFloor, cMoss, smoothstep(0.55,0.75,tn) * (1.-smoothstep(0.6,0.9,vData.x))) * mix(vec3(1.), gr, 0.5);
    col = mix(col, grC, g);
    // sombreamento: luz de céu com oclusão assada e normal de detalhe
    vec3 Nd = triN(P, N, w, 1./38.);
    float skyv = vCol.g;
    // luz de céu: domo + chave suave vinda do céu claro atrás da câmera (nordeste), pra o relevo ler
    vec3 key = normalize(vec3(0.55, 0.42, 0.72));
    float kd = max(dot(Nd, key), 0.);
    float shade = (0.42 + 0.22*Nd.y + 0.62*kd) * mix(0.5, 1.12, skyv);
    col *= shade;
    // neve: máscaras assadas + patamares (normal quase horizontal em zona de rocha alta)
    float hiAlt = smoothstep(380., 650., P.y);
    float ledgeS = smoothstep(0.62, 0.86, Nd.y) * smoothstep(0.45, 0.8, 1. - N.y) * hiAlt;
    ledgeS *= smoothstep(0.5, 0.7, fbm(P.xz/26. + vec2(P.y*0.05)));
    float sn = max(vCol.b, ledgeS) + (fbm(P.xz/45.)-0.5)*0.4 + (fbm(P.xz/9.)-0.5)*0.15;
    float snow = smoothstep(0.32, 0.72, sn) * (1. - tal*0.8);
    vec3 snS = cSnowS * (0.85 + 0.25*Nd.y) * mix(vec3(1.), tri(tSnow, P, w, 1./30.)/mSnow, 0.4);
    // alpenglow: só onde o sol baixo enxerga
    float sun = smoothstep(0.08, 0.6, vCol.r) * clamp(0.6 + 0.6*dot(Nd, N), 0., 1.2);
    vec3 lit = mix(mix(cSun2, cSun, smoothstep(0.1,0.3,az)) * rd * strat, cSnowL, snow);
    col = mix(col, snS, snow);
    col = mix(col, lit, clamp(sun, 0., 1.));
    col = applyHaze(col, P);
    gl_FragColor = vec4(col, 1.);
  }`,
});

if (window.D_BAKE && !Q.has('nobake')) { T.bake = tex(window.D_BAKE, false); T.bake.anisotropy = 16; tU.tBake.value = T.bake; tU.useBake.value = 1; }
if (window.D_BAKE2 && !Q.has('nomtn')) { T.bake2 = tex(window.D_BAKE2, false); T.bake2.anisotropy = 16; tU.tBake2.value = T.bake2; tU.useBake2.value = 1; }   // item 72: render novo das montanhas do fundo

/* ---------- água: reflexo planar (técnica do Reflector) ---------- */
let reflRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const virtualCam = new THREE.PerspectiveCamera();
const textureMatrix = new THREE.Matrix4();
/* jogo dos erros (água): calibração em grade, por lado do lago e por distância (tools/water_grid.py, blender/water_grid.json): ganho a e corpo b
   por canal sobre o reflexo cru. Só parâmetros, a foto não entra na cena. Ancorada no lago pela câmera de referência (?oldgrade volta) */
const WGRID = {"x0": 0, "cw": 250.0, "y0": 770, "by": 40, "nx": 8, "ny": 15, "a": [[[0.583, 0.7023, 0.8422], [0.463, 0.6137, 0.7758], [0.5023, 0.6476, 0.7989], [0.5977, 0.7038, 0.8158], [0.6616, 0.8001, 0.9838], [0.5624, 0.6236, 0.6702], [0.5618, 0.6488, 0.7356], [0.6025, 0.7144, 0.8335]], [[0.5412, 0.7558, 1.0219], [0.4758, 0.6929, 0.9386], [0.5053, 0.711, 0.8833], [0.5575, 0.7066, 0.8201], [0.5273, 0.7187, 0.8972], [0.347, 0.5865, 0.7102], [0.3415, 0.5709, 0.6757], [0.4779, 0.6473, 0.7722]], [[0.3977, 0.7399, 1.0925], [0.3896, 0.6689, 0.9759], [0.3535, 0.5837, 0.7708], [0.4358, 0.5975, 0.7021], [0.4081, 0.5717, 0.6968], [0.2712, 0.5729, 0.7124], [0.2314, 0.7343, 0.9598], [0.2534, 0.5484, 0.7215]], [[0.2752, 0.5629, 0.8326], [0.2966, 0.5579, 0.7864], [0.2315, 0.459, 0.6129], [0.3325, 0.4743, 0.544], [0.3298, 0.4751, 0.5587], [0.2614, 0.4946, 0.6422], [0.2055, 0.7025, 1.1026], [0.2184, 0.6751, 1.1004]], [[0.1686, 0.3819, 0.531], [0.1999, 0.4258, 0.5535], [0.1929, 0.4568, 0.6008], [0.3256, 0.4895, 0.5534], [0.2664, 0.4438, 0.5183], [0.2265, 0.4569, 0.6103], [0.2056, 0.5966, 0.9962], [0.2924, 0.6768, 1.1865]], [[0.1146, 0.3643, 0.5654], [0.1325, 0.3515, 0.4793], [0.1396, 0.4166, 0.5735], [0.2584, 0.424, 0.509], [0.2014, 0.3714, 0.4576], [0.2088, 0.399, 0.5356], [0.3011, 0.4895, 0.7444], [0.7186, 0.7371, 1.1167]], [[0.0849, 0.4419, 0.8066], [0.0887, 0.2857, 0.4475], [0.0985, 0.2929, 0.4163], [0.1721, 0.3, 0.3777], [0.1404, 0.2747, 0.3573], [0.1865, 0.3483, 0.4657], [0.207, 0.396, 0.6187], [0.4017, 0.5819, 0.9696]], [[0.0802, 0.5, 0.9688], [0.0811, 0.3051, 0.5253], [0.1035, 0.2766, 0.3938], [0.1468, 0.2723, 0.348], [0.1473, 0.2658, 0.3446], [0.1918, 0.3455, 0.4675], [0.2055, 0.3734, 0.5703], [0.1929, 0.3629, 0.5732]], [[0.0855, 0.4395, 0.8138], [0.0956, 0.3216, 0.5431], [0.1381, 0.3024, 0.4237], [0.1656, 0.2855, 0.3673], [0.1982, 0.3105, 0.4088], [0.182, 0.3339, 0.4584], [0.2052, 0.3313, 0.4352], [0.2066, 0.3472, 0.4681]], [[0.1082, 0.3608, 0.5607], [0.1105, 0.2782, 0.3992], [0.1373, 0.2627, 0.3456], [0.1928, 0.2783, 0.3487], [0.2927, 0.3468, 0.4606], [0.2221, 0.4436, 0.6167], [0.1961, 0.3317, 0.4697], [0.2187, 0.3023, 0.4568]], [[0.139, 0.3739, 0.5437], [0.1708, 0.2901, 0.3489], [0.1975, 0.2771, 0.318], [0.3203, 0.3154, 0.3601], [0.3586, 0.3304, 0.4381], [0.2927, 0.641, 0.8589], [0.28, 0.512, 0.6062], [0.2808, 0.3542, 0.3525]], [[0.1781, 0.6464, 0.9097], [0.286, 0.3809, 0.4225], [0.2525, 0.2854, 0.3053], [0.4315, 0.4045, 0.4435], [0.4461, 0.3291, 0.4459], [0.4116, 0.6092, 0.8858], [0.3825, 0.6838, 0.6562], [0.3375, 0.5093, 0.4087]], [[0.1788, 0.6743, 1.0268], [0.3713, 0.4984, 0.5875], [0.3073, 0.4151, 0.4815], [0.3767, 0.4069, 0.4703], [0.4352, 0.3327, 0.4317], [0.3975, 0.5678, 0.7506], [0.4179, 0.6568, 0.6426], [0.2658, 0.5028, 0.4641]], [[0.1115, 0.6162, 1.0268], [0.2346, 0.5038, 0.6344], [0.3004, 0.4504, 0.5657], [0.38, 0.3655, 0.4602], [0.4768, 0.351, 0.4053], [0.2856, 0.5724, 0.5774], [0.2469, 0.5039, 0.5572], [0.2039, 0.5832, 0.4866]], [[0.1024, 0.5899, 1.0132], [0.1565, 0.4255, 0.5455], [0.1984, 0.2824, 0.3451], [0.3191, 0.2613, 0.3196], [0.4546, 0.3198, 0.3836], [0.2372, 0.515, 0.5419], [0.1925, 0.4318, 0.5132], [0.2292, 0.6984, 0.5572]]], "b": [[[0.01073, 0.02703, 0.02708], [0.03446, 0.0486, 0.0472], [0.00407, 0.02949, 0.03464], [-0.00083, 0.02483, 0.02975], [0.00835, 0.02755, 0.02601], [0.00754, 0.02218, 0.01718], [0.00616, 0.02399, 0.02353], [0.00572, 0.0256, 0.02693]], [[-0.00159, 0.01318, 0.01276], [0.01058, 0.03589, 0.0364], [-0.00664, 0.03149, 0.04111], [-0.00593, 0.03604, 0.04633], [0.00326, 0.04172, 0.04633], [0.00215, 0.03234, 0.0333], [0.00082, 0.02543, 0.02648], [-0.00012, 0.02512, 0.02821]], [[-0.00207, 0.01678, 0.01841], [-0.00187, 0.03608, 0.03853], [-0.00882, 0.04619, 0.05946], [-0.00385, 0.06087, 0.07727], [-8e-05, 0.06329, 0.07634], [-0.0008, 0.04475, 0.05296], [-0.00046, 0.02691, 0.03091], [-0.00025, 0.01389, 0.01521]], [[-0.00569, 0.02152, 0.02805], [-0.00916, 0.03999, 0.05042], [-0.0045, 0.06488, 0.08536], [0.00589, 0.08915, 0.11292], [0.0031, 0.07896, 0.10049], [0.00045, 0.05292, 0.06684], [-0.00067, 0.02906, 0.03561], [-0.00011, 0.01068, 0.01245]], [[-0.0044, 0.02633, 0.03708], [-0.00887, 0.04633, 0.06507], [-0.01127, 0.06759, 0.09362], [-0.01771, 0.08748, 0.11609], [-0.01196, 0.08073, 0.10671], [0.00334, 0.06583, 0.08412], [0.00365, 0.03583, 0.04518], [-0.00054, 0.01109, 0.01362]], [[-0.00274, 0.0292, 0.04121], [-0.00657, 0.05044, 0.07073], [-0.01248, 0.06704, 0.09353], [-0.02916, 0.08241, 0.11401], [-0.0136, 0.08385, 0.1109], [0.01722, 0.07857, 0.0969], [0.01978, 0.04975, 0.06138], [0.00174, 0.01601, 0.02075]], [[-0.00225, 0.02675, 0.03831], [-0.00461, 0.05022, 0.07065], [-0.01422, 0.06681, 0.09367], [-0.03194, 0.08227, 0.1145], [-0.01396, 0.08627, 0.11357], [0.01887, 0.08006, 0.09714], [0.02317, 0.05189, 0.06205], [0.00891, 0.02107, 0.02543]], [[-0.00226, 0.02603, 0.03783], [-0.00479, 0.04772, 0.06842], [-0.01967, 0.06658, 0.09372], [-0.033, 0.08408, 0.11489], [-0.02098, 0.08454, 0.11133], [0.00623, 0.07244, 0.08804], [0.01178, 0.04801, 0.05758], [0.02028, 0.02752, 0.03057]], [[-0.00232, 0.02866, 0.0422], [-0.00662, 0.04835, 0.06884], [-0.02937, 0.06594, 0.0916], [-0.03527, 0.08535, 0.11283], [-0.02213, 0.0892, 0.11392], [0.00933, 0.07167, 0.08355], [-0.00665, 0.04413, 0.05527], [0.00019, 0.02387, 0.02857]], [[-0.00287, 0.02766, 0.04103], [-0.00668, 0.04815, 0.06851], [-0.0311, 0.06438, 0.09079], [-0.04873, 0.08021, 0.11094], [-0.02677, 0.10434, 0.1328], [0.04277, 0.04859, 0.06757], [-0.04071, 0.03252, 0.04275], [-0.04581, 0.0263, 0.03178]], [[-0.00261, 0.02608, 0.03881], [-0.00874, 0.04609, 0.06697], [-0.05419, 0.05464, 0.08497], [-0.1196, 0.05398, 0.08407], [-0.02644, 0.11373, 0.12957], [0.11324, -0.00993, -0.00707], [-0.02886, -0.0201, -0.00224], [-0.07341, 0.0044, 0.02502]], [[-0.00309, 0.02159, 0.03491], [-0.01354, 0.04064, 0.06147], [-0.07247, 0.03989, 0.06726], [-0.16203, 0.0179, 0.04709], [-0.10646, 0.09804, 0.1045], [0.02183, -0.00513, -0.0444], [-0.0439, -0.07287, -0.02379], [-0.07065, -0.04221, -0.00383]], [[-0.00429, 0.01985, 0.03197], [-0.01858, 0.03523, 0.05264], [-0.06991, 0.02729, 0.03297], [-0.12791, 0.02564, 0.043], [-0.13801, 0.06964, 0.08257], [-0.08849, -0.0286, -0.03537], [-0.24677, -0.09328, -0.02991], [-0.11068, -0.05495, -0.02387]], [[-0.00293, 0.01661, 0.02655], [-0.02095, 0.02475, 0.03104], [-0.08451, 0.01845, -0.00657], [-0.15096, 0.03319, 0.02975], [-0.19485, 0.03997, 0.06532], [-0.03899, -0.06589, -0.01008], [-0.11743, -0.05577, -0.02101], [-0.06064, -0.07423, -0.03919]], [[-0.00356, 0.01405, 0.02303], [-0.01097, 0.04159, 0.05964], [-0.04043, 0.09549, 0.11653], [-0.12584, 0.07789, 0.0998], [-0.18474, 0.04248, 0.06292], [-0.00514, -0.05807, -0.01799], [-0.05297, -0.03296, -0.02052], [-0.06987, -0.10077, -0.05962]]]};
function wgridTex(key, lo, hi) {
  const nx = WGRID.nx, ny = WGRID.ny, d = new Uint8Array(nx * ny * 4);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { for (let c = 0; c < 3; c++) d[(j * nx + i) * 4 + c] = Math.round(255 * Math.min(1, Math.max(0, (WGRID[key][j][i][c] - lo) / (hi - lo)))); d[(j * nx + i) * 4 + 3] = 255; }
  const t = new THREE.DataTexture(d, nx, ny, THREE.RGBAFormat); t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; return t;
}
const wU = {
  time: U.time, yaw: U.yaw, skyTex: U.skyTex, tRefl: { value: reflRT.texture }, textureMatrix: { value: textureMatrix },
  cBody: { value: lin(TUNE.waterBody) }, cShallow: { value: lin(TUNE.waterShallow) }, cDeep: { value: lin(TUNE.waterDeep) },
  reflBase: { value: TUNE.reflBase }, reflGain: { value: TUNE.reflGain }, reflTint: { value: lin(TUNE.reflTint) },
  rippleAmp: { value: TUNE.rippleAmp }, camRef: U.camRef, reflRes: { value: new THREE.Vector2(1, 1) },
  /* passo 3 (progresso): água ciano medida na foto, reflexo um pouco mais escuro e azulado que o objeto, fresnel (?nowater3 volta) */ partK: { value: Q.has('nowater3') ? 0 : 1 }, partW: { value: Q.has('noripple') ? 0 : 1 }, cBodyK: { value: lin('#16a0b6') }, cDeepK: { value: lin('#035b68') }, reflBaseK: { value: 0.28 },
  tWA: { value: wgridTex('a', 0, 1.2) }, tWB: { value: wgridTex('b', -0.25, 0.14) }, wGridY: { value: new THREE.Vector2(WGRID.y0, WGRID.ny * WGRID.by) },
  refR: { value: REF_BASIS[0] }, refU: { value: REF_BASIS[1] }, refF: { value: REF_BASIS[2] }, refFoc: { value: 1000 / Math.tan(C.hfov * DEG / 2) },
  shoreY: { value: [776, 780, 787, 797, 804, 811, 817, 826, 831, 836, 842, 849, 854, 859, 865, 872, 877] },   // margem da mata da direita na vista, x 1200 a 2000
};
const waterMat = new THREE.ShaderMaterial({
  uniforms: wU,
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUvR; varying vec3 vP;
  void main(){ vec4 wp = modelMatrix*vec4(position,1.); vP = wp.xyz; vUvR = textureMatrix*vec4(position,1.);
    gl_Position = projectionMatrix*viewMatrix*wp; }`,
  fragmentShader: GLSL_COMMON + `
  uniform sampler2D tRefl; uniform vec2 reflRes; uniform float time, reflBase, reflGain, rippleAmp, partK, reflBaseK, partW; uniform vec3 cBody, cShallow, cDeep, reflTint, camRef, cBodyK, cDeepK;
  uniform sampler2D tWA, tWB; uniform vec2 wGridY; uniform vec3 refR, refU, refF; uniform float refFoc; uniform float shoreY[17];
  varying vec4 vUvR; varying vec3 vP;
  vec2 ripple(vec2 p, float t){
    float e = 0.35;
    vec2 a = p*0.32 + vec2(t*0.21, t*0.13), b = p*1.1 + vec2(-t*0.47, t*0.36), c = p*3.4 + vec2(t*0.83, -t*0.61);   // passo 14: terceira camada, micro ondas mais rápidas
    float h0 = fbm3(a) + 0.45*fbm3(b) + 0.16*fbm3(c);
    float hx = fbm3(a+vec2(e*0.32,0.)) + 0.45*fbm3(b+vec2(e*1.1,0.)) + 0.16*fbm3(c+vec2(e*3.4,0.));
    float hz = fbm3(a+vec2(0.,e*0.32)) + 0.45*fbm3(b+vec2(0.,e*1.1)) + 0.16*fbm3(c+vec2(0.,e*3.4));
    return vec2(hx-h0, hz-h0)/e;
  }
  void main(){
    vec3 V = cameraPosition - vP; float d = length(V); V /= d;
    // ondulação: duas camadas, mais visível perto (embaixo do quadro); some com a distância
    float near = 1. - smoothstep(60., 900., d);
    float gust = 0.75 + 0.5*fbm3(vP.xz/420. + vec2(time*0.012, -time*0.009));
    // normal em duas camadas bem fracas: só pra viver, sem quebrar o espelho
    vec2 g = ripple(vP.xz, time) * rippleAmp * (0.15 + 0.85*near) * gust;
    // pedido (água parada demais): ondinhas de verdade que entortam o reflexo. Dois trens de onda com dispersão de águas
    // profundas (w = raiz(g k)), comprimentos 3 m e 1,3 m, cristas quase de frente pra câmera (quebram o reflexo em faixas
    // horizontais), fase torta por ruído e força em manchas que andam devagar (lufadas); somem com a distância pra não serrilhar
    vec2 wv = vec2(0.);
    if (${Q.has('nowaves') ? 'false' : 'true'}) {
      float lufa = 0.35 + 0.65 * smoothstep(0.32, 0.72, fbm3(vP.xz / 90. + vec2(time * 0.031, time * 0.017)));
      vec2 d1 = vec2(0.26, 0.966), d2 = vec2(-0.6, 0.8); float k1 = 2.094, k2 = 4.833;
      float ph1 = k1 * dot(d1, vP.xz) - sqrt(9.81 * k1) * time + fbm3(vP.xz / 30.) * 6.;
      float ph2 = k2 * dot(d2, vP.xz) - sqrt(9.81 * k2) * time + fbm3(vP.xz / 17. + 3.) * 6.;
      wv = d1 * cos(ph1) * (1. - smoothstep(250., 650., d)) + d2 * cos(ph2) * 0.6 * (1. - smoothstep(120., 320., d));
      wv *= lufa * (0.25 + 0.75 * near);
      if (${Q.has('oldagua') ? 'false' : 'true'}) wv *= 0.45;   // redo, peça água (0,22 deixou a água parada: pedido 'travado'): quase espelho, sem as linhas horizontais regulares
      if (${Q.has('oldlisa') ? 'false' : 'true'}) wv *= 0.5;    // jogo dos erros 44: os trens de onda viravam riscos finos em toda a água; a foto é espelho (o balanço largo continua)
    }
    vec3 N = normalize(vec3(-g.x*0.03 - wv.x*0.05, 1., -g.y*0.03 - wv.y*0.05));
    float cosT = clamp(dot(V, N), 0., 1.);
    float F = 0.02 + 0.98*pow(1. - cosT, 5.);
    vec4 uvr = vUvR; uvr.xy += g * vec2(0.3, 0.13) * (0.15 + 0.85*near) * (partW > 0.5 ? 2.6 : 1.) * (${Q.has('oldagua') ? '1.' : '0.25'}) * (${Q.has('oldlisa') ? '1.' : '0.5'});   // erro 45: escamas no reflexo do cone   // passo 14: ondinha quebra o reflexo de lado (linhas horizontais), pouco na vertical   // ondulação fina quebra o espelho (mais perto da câmera)
    // reflexo planar em resolução cheia, ~15% mais escuro, um pouco mais macio longe
    vec2 px = uvr.w / reflRes;
    // bloco 4 (crítico de movimento: "espelho congelado"): faixas largas e lentas que balançam o reflexo de lado, em duas
    // camadas com velocidade e direção diferentes, mais forte perto da câmera (?nowob desliga)
    if (${Q.has('nowob') ? 'false' : 'true'}) {
      float wb1 = fbm3(vec2(vP.x / 260. + time * 0.05, vP.z / 18. - time * 0.42));
      float wb2 = fbm3(vec2(vP.x / 140. - time * 0.08, vP.z / 9. + time * 0.27));
      float wAmp = (0.35 + 1.65 * near) * (0.6 + 0.8 * gust) * (${Q.has('oldagua') ? '1.' : '0.7'});   // redo: balanço leve (0,4 deixou parado)
      uvr.x += ((wb1 - 0.5) * 3.2 + (wb2 - 0.5) * 1.6) * px.x * wAmp;
      uvr.y += (wb1 - 0.5) * 0.8 * px.y * wAmp;
    }
    uvr.x += wv.x * px.x * 2.5; uvr.y += wv.y * px.y * 3.5;   // as ondinhas entortam o reflexo (mais na vertical, como na água de verdade)
    float soft = smoothstep(300., 2500., d) * 0.8;   // item 85: desfoque perto (r85b) perdeu no crítico: virou faixa borrada
    vec3 refl = texture2DProj(tRefl, uvr).rgb * 0.4;
    refl += texture2DProj(tRefl, uvr + vec4(px.x*soft, 0., 0., 0.)).rgb * 0.15;
    refl += texture2DProj(tRefl, uvr - vec4(px.x*soft, 0., 0., 0.)).rgb * 0.15;
    refl += texture2DProj(tRefl, uvr + vec4(0., px.y*soft, 0., 0.)).rgb * 0.15;
    refl += texture2DProj(tRefl, uvr - vec4(0., px.y*soft, 0., 0.)).rgb * 0.15;
    if (partW > 0.5) {   // água com ondinha: o reflexo alonga um pouco na vertical (nunca na horizontal)
      vec3 rv = texture2DProj(tRefl, uvr + vec4(px.x * 2.5 * (0.3 + near), 0., 0., 0.)).rgb + texture2DProj(tRefl, uvr - vec4(px.x * 2.5 * (0.3 + near), 0., 0., 0.)).rgb;   // passo 14: borrão leve de lado (era vertical: "metal escovado")
      refl = refl * 0.7 + rv * 0.15;
    }
    if (${Q.has('oldagua') ? 'false' : 'true'}) {   // redo volta 2: espelho macio, borrão leve na vertical (sem linha de varredura), tons contínuos
      // volta 4 (troca de técnica): reflexo nítido direto do alvo; só quebras horizontais finas e raras, em faixas que andam devagar
      float brk = smoothstep(0.78, 0.9, fbm3(vec2(vP.x / 400. + time * 0.03, vP.z / 2.2 - time * 0.16))) * (0.3 + 0.7 * near);
      refl = texture2DProj(tRefl, uvr + vec4(px.x * 5. * brk, 0., 0., 0.)).rgb;
    }
    vec3 reflRaw = refl;
    refl *= reflTint * (partK > 0.5 ? 1.0 : 0.9);
    vec3 reflO = refl;                                  // passo 14: cor do objeto refletido, antes do tom turquesa
    float farW = ${Q.has('noespelho') ? '0.' : '1.'} * smoothstep(380., 720., d);   // perto da margem do fundo a água vira espelho (foto: mata #202C22, leque #8A8181)
    float rl = dot(refl, vec3(0.2126, 0.7152, 0.0722));
    refl = partK > 0.5 ? mix(mix(refl * vec3(0.16, 0.8, 1.0) * 0.9, refl * vec3(0.5, 0.95, 1.05) * 0.95, smoothstep(0.3, 0.8, rl)), refl * vec3(0.92, 0.92, 0.92), smoothstep(0.04, 0.16, (refl.r - refl.b) / max(rl, 0.02)) * smoothstep(0.15, 0.35, rl))   // passo 3c: frio vira ciano, nuvem quente fica quente   // passo 3: reflexo mais escuro e azulado; neve e céu quase intactos   // item 85: reflexo escuro e médio vira teal (como na foto)
                      : mix(refl * vec3(0.3, 0.95, 1.22), refl * vec3(0.9, 1.0, 1.02), smoothstep(0.05, 0.4, rl));   // reflexo escuro puxa pro turquesa
    // corpo d'água: turquesa forte (#1a8f9c) ao longe e na margem, teal profundo (#0b4a52) embaixo, perto da câmera
    float down = smoothstep(90., 650., d);
    vec3 body = partK > 0.5 ? mix(cDeepK, cBodyK, down) : mix(cDeep, cBody, down);
    body *= 0.94 + 0.12*fbm3(vP.xz/160.);
    // fresnel: longe quase só reflexo, perto mais cor
    float rB = partK > 0.5 ? reflBaseK : reflBase;
    float k = clamp(rB + (1. - rB)*smoothstep(0.0, 0.35, F)*reflGain, 0., 0.96);
    // bloco 4: fresnel mais perto do físico. A base do quadro vê a água a ~20° (F ~0,13) e a foto mostra o reflexo da nuvem
    // bem mais escuro que o céu ali (#5E595D contra #D59087); a curva antiga dava k ~0,5 e a nuvem refletida quase com o brilho do céu
    if (${Q.has('oldfres') ? 'false' : 'true'}) k = clamp(0.10 + 1.6 * F * reflGain, 0., 0.96);
    refl = mix(refl, reflO * vec3(0.9, 0.97, 0.98), farW * 0.6); k = mix(k, 0.95, farW * 0.5);   // crítico q16c: espelho só bem perto da margem do fundo
    // corpo (espalhamento na água glacial) + reflexo de superfície somados: reflexo escuro vira teal, claro continua quente
    refl = mix(refl, reflO * 0.94, smoothstep(0.16, 0.34, dot(reflO, vec3(0.2126, 0.7152, 0.0722))) * smoothstep(0.75, 0.9, min(reflO.b / max(reflO.r, 1e-3), 1.2)) * 0.85);   // passo 15: neve refletida branca (só o que é claro e neutro) (estava ciano)
    if (${Q.has('oldagua') ? 'false' : 'true'}) { float dk = smoothstep(40., 520., d); body *= mix(vec3(0.42, 0.66, 0.80), vec3(0.96, 1.14, 1.16), dk); refl *= mix(0.72, 1.06, dk);   // harmonizador: meio e fundo mais claros e ciano
      float rlo = dot(reflO, vec3(0.2126, 0.7152, 0.0722)); refl *= mix(0.72, 1., smoothstep(0.25, 0.45, rlo) * smoothstep(0.6, 0.95, reflO.b / max(reflO.r, 1e-3))); }   // volta 2: encosta e paredão refletidos mais escuros (sombra funda em teal), neve e nuvem intactas   // redo: turquesa mais fundo e escuro rumo à borda de baixo
    vec3 col = body*(1. - 0.93*k)*(1. - farW * 0.5) + refl*k;   // passo 15
    if (${Q.has('oldagua') ? 'false' : 'true'}) col *= vec3(mix(0.84, 0.48, smoothstep(40., 520., d)), 1.3, 1.25);   // ganho medido (foto/cena 0,72 1,18 1,15 em sRGB, levado pro linear): menos vermelho, mais ciano: longe, mata refletida verde escura (foto #202C22), pouco corpo turquesa por cima
    if (${Q.has('oldnuvem') ? 'false' : 'true'}) {
      // pedido (nuvens): a nuvem rosa refletida sumia (foto 202,131,114 x nossa 105,106,105): o ganho de cima corta o vermelho de tudo.
      // Reflexo de céu e de coisa clara (nuvem, céu lilás, neve, pico aceso) = espelho com ~45 a 65% do brilho do objeto
      // (medido: nuvem 247,167,139 no céu e 202,131,114 na água), mais um pouco do corpo turquesa por baixo
      float rlo2 = dot(reflO, vec3(0.2126, 0.7152, 0.0722));
      float skyM = smoothstep(0.2, 0.38, rlo2) * smoothstep(0.1, 0.5, (reflO.r - reflO.b) / max(rlo2, 1e-3));   // só o que é quente (nuvem, céu rosado, pico aceso); o céu cinza azulado da esquerda continua teal escuro como na foto
      // jogo dos erros 46 e 47: leque claro refletia teal escuro e o corredor de neve ciano; na foto o reflexo de coisa clara mantém
      // a cor dela (cinza rosado, branco), só o céu azulado e a rocha escura viram teal (?oldespelho volta)
      if (${Q.has('oldespelho') ? 'false' : 'true'}) skyM = max(skyM, smoothstep(0.15, 0.24, rlo2) * (1. - smoothstep(0.0, 0.2, (reflO.b - reflO.r) / max(rlo2, 1e-3))) * 0.8);   // v2: só coisa clara (neve, cascalho claro); rocha continua teal
      float kc = mix(0.5, 0.78, smoothstep(60., 260., d));   // v2: medido 15% escuro com 0,42 a 0,66
      if (${Q.has('refperto') ? 'true' : 'false'}) kc = mix(0.24, 0.8, smoothstep(110., 300., d));   // v3 (piores blocos do quadro): perto da câmera a foto reflete bem menos
      vec3 colS = reflO * kc + body * (1. - kc) * 0.35;
      col = mix(col, colS, skyM);
    }
    if (${Q.has('oldgrade') || Q.has('dbgrefl') ? 'false' : 'true'}) {
      // jogo dos erros (água, piores blocos do quadro): espelho + corpo d'água calibrados por lugar do lago. Na foto o reflexo das
      // montanhas é cinza amarronzado, a borda esquerda e o canto de baixo à direita são bem mais escuros e a nuvem refletida é
      // salmão forte; uma curva só por distância não dava conta (água ΔE 11,9 com ela, 6,5 com a grade no teste)
      vec3 rdW = vP - camRef; float zfW = max(dot(rdW, refF), 1.);
      float xvW = 1000. + 0.96 * refFoc * dot(rdW, refR) / zfW, yvW = 669.8 - 0.96 * refFoc * dot(rdW, refU) / zfW;
      vec2 wuv = vec2(xvW / 2000., (yvW - wGridY.x) / wGridY.y);
      vec3 gA = texture2D(tWA, wuv).rgb * 1.2, gB = mix(vec3(-0.25), vec3(0.14), texture2D(tWB, wuv).rgb);
      col = max(gA * reflRaw + gB, vec3(0.));
    }
    if (${Q.has('oldbeiraagua') ? 'false' : 'true'}) {
      // revisão (margem da água): logo abaixo da margem da mata da direita a foto mostra a mata refletida, verde escura e com
      // textura de tronco, e só vira turquesa uns 30 px abaixo. A grade de calibração apagava isso (turquesa liso até a terra).
      // Linha da margem medida na vista (shoreY, x 1200 a 2000 a cada 50 px), ancorada no mundo pela câmera de referência (?oldbeiraagua volta)
      vec3 rdS = vP - camRef; float zfS = max(dot(rdS, refF), 1.);
      float xS = 1000. + 0.96 * refFoc * dot(rdS, refR) / zfS, yS = 669.8 - 0.96 * refFoc * dot(rdS, refU) / zfS;
      float fS = clamp((xS - 1200.) / 50., 0., 15.99); int iS = int(floor(fS));
      float dS = yS - mix(shoreY[iS], shoreY[iS + 1], fract(fS));
      float kS = smoothstep(1150., 1210., xS) * step(-8., dS) * (1. - smoothstep(4., 34., dS + (fbm3(vec2(xS / 9., time * 0.04)) - 0.5) * 8.));
      float lS = dot(reflRaw, vec3(0.2126, 0.7152, 0.0722));
      float txS = clamp(0.55 + lS * 25., 0.6, 1.5);   // a textura da mata refletida (troncos mais escuros, copas mais claras)
      col = mix(col, col * vec3(1.5, 0.86, 0.68) * txS, kS);
    }
    if (${Q.has('dbgrefl') ? 'true' : 'false'}) col = texture2DProj(tRefl, vUvR).rgb;
    gl_FragColor = vec4(col, 1.);
  }`,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.copy(camPos0).addScaledVector(new THREE.Vector3(fwd.x, 0, fwd.z).normalize(), 2500); water.position.y = 0;
water.updateMatrixWorld(); scene.add(water);
if (Q.has('nowater')) water.visible = false;

function renderReflection() {
  const normal = new THREE.Vector3(0, 1, 0), mirrorPos = new THREE.Vector3(0, 0, 0);
  const camWP = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const view = new THREE.Vector3().subVectors(mirrorPos, camWP);
  if (view.dot(normal) > 0) return;
  view.reflect(normal).negate().add(mirrorPos);
  const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
  const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camWP);
  const tgt = new THREE.Vector3().subVectors(mirrorPos, look).reflect(normal).negate().add(mirrorPos);
  virtualCam.position.copy(view);
  virtualCam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
  virtualCam.lookAt(tgt);
  virtualCam.far = camera.far; virtualCam.near = camera.near;
  virtualCam.updateMatrixWorld(); virtualCam.projectionMatrix.copy(camera.projectionMatrix);
  textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  textureMatrix.multiply(virtualCam.projectionMatrix).multiply(virtualCam.matrixWorldInverse).multiply(water.matrixWorld);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(virtualCam.matrixWorldInverse);
  const cp = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  const pm = virtualCam.projectionMatrix, q = new THREE.Vector4();
  q.x = (Math.sign(cp.x) + pm.elements[8]) / pm.elements[0];
  q.y = (Math.sign(cp.y) + pm.elements[9]) / pm.elements[5];
  q.z = -1.0; q.w = (1.0 + pm.elements[10]) / pm.elements[14];
  cp.multiplyScalar(2.0 / cp.dot(q));
  pm.elements[2] = cp.x; pm.elements[6] = cp.y; pm.elements[10] = cp.z + 1.0 - 0.003; pm.elements[14] = cp.w;
  water.visible = false; sky.position.copy(virtualCam.position);
  tU.clipY.value = -0.5;
  renderer.setRenderTarget(reflRT); renderer.clear(); renderer.render(scene, virtualCam);
  tU.clipY.value = -1e9;
  water.visible = !Q.has('nowater'); sky.position.copy(camera.position);
}

/* ---------- máscara de floresta no quadro (vegetação: chão escuro sob as árvores longe) ---------- */
function buildFloor(ip, ia, n) {
  const W = 1000, H = 667, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d');
  const camKeep = camera.position.clone();   // devolve a posição no fim (o ?oaz/?opo do print de órbita era desfeito aqui)
  camera.position.copy(camPos0); camera.lookAt(targetRef); setFov(true); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const v = new THREE.Vector3(), v2 = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const x = ip[i * 3], y = ip[i * 3 + 1], z = ip[i * 3 + 2]; const dx = x - camPos0.x, dz = z - camPos0.z;
    if (dx * dx + dz * dz < 1100 * 1100) continue;
    let h = ia[i * 4]; const thin = h >= 100; if (thin) h -= 100;
    v.set(x, y, z).project(camera); v2.set(x, y + h, z).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.3 || Math.abs(v.y) > 1.3) continue;
    const X = (v.x * 0.5 + 0.5) * W, Y = (0.5 - v.y * 0.5) * H, Yt = (0.5 - v2.y * 0.5) * H;
    const hp = Math.max(Y - Yt, 0.5), wp = Math.max(hp * (thin ? 0.22 : 0.4) * 1.6, 0.8);
    cx.fillStyle = 'rgba(255,' + Math.min(255, Math.round(Math.sqrt(dx * dx + dz * dz) / 8000 * 255)) + ',0,0.55)';   // G = distância da árvore (só escurece o chão na mesma distância)
    cx.fillRect(X - wp / 2, Yt + hp * 0.15, wp, hp * 0.85 + 1.2);
  }
  const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = H; const c2 = cv2.getContext('2d'); c2.filter = 'blur(1.5px)'; c2.drawImage(cv, 0, 0);
  camera.position.copy(camKeep);
  const t = new THREE.CanvasTexture(cv2); t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; return t;
}

/* ---------- floresta: cartões cruzados instanciados ---------- */
let trees = null;
function buildTrees() {
  const raw = B64(window.D_TREES); window.D_TREES = null; LT('arvores decodificadas');
  const f = new Float32Array(raw.buffer); const n = f.length / 7;
  const g = new THREE.InstancedBufferGeometry();
  const w = 0.5;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, w, 1, 0, -w, 1, 0, 0, 0, -w, 0, 0, w, 0, 1, w, 0, 1, -w], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const ip = new Float32Array(n * 3), ia = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    ip[i * 3] = f[i * 7]; ip[i * 3 + 1] = f[i * 7 + 1]; ip[i * 3 + 2] = f[i * 7 + 2];
    ia[i * 4] = f[i * 7 + 3]; ia[i * 4 + 1] = f[i * 7 + 4]; ia[i * 4 + 2] = f[i * 7 + 5]; ia[i * 4 + 3] = f[i * 7 + 6];
  }
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(ip, 3));
  g.setAttribute('iAttr', new THREE.InstancedBufferAttribute(ia, 4));
  g.instanceCount = n;
  if (!Q.has('nofloor')) { tU.tFloorM.value = buildFloor(ip, ia, n); tU.useFloor.value = 1; setFov(); } LT('mascara do chao');   // chão sob a mata: suave, só onde a mata é densa (a versão forte virou mancha preta)
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({ tSpruce: { value: T.spruce }, cTree: { value: lin(TUNE.tree) }, cTreeLit: { value: lin(TUNE.treeLit) }, clipY: tU.clipY, aaT: U.aaT, cTreeFar: { value: lin('#34362c') } }, {
      time: U.time, yaw: U.yaw, skyTex: U.skyTex, haze: tU.haze, hazeDist: tU.hazeDist, camRef: U.camRef,
      refR: { value: REF_BASIS[0] }, refU: { value: REF_BASIS[1] }, refF: { value: REF_BASIS[2] }, refFoc: { value: 1000 / Math.tan(C.hfov * DEG / 2) }, wallE: tU.wallE }),
    vertexShader: `
    attribute vec3 iPos; attribute vec4 iAttr; uniform float time; uniform vec3 camRef, refR, refU, refF; uniform float refFoc; uniform float wallE[35]; varying float vTone, vSnag; varying vec2 vUv; varying vec4 vA; varying vec3 vP; varying float vY; varying float vFar; varying vec2 vBand; varying float vRF; varying float vRFh; varying vec3 vDbg;
    // pedido ("movimento de vento na floresta"): rajadas que andam pela mata a ~6 m/s na direção do vento (quase de lado pra
    // câmera, um pouco pro fundo), em três escalas sem relação (rajada curta, rajada longa, calmaria e período de vento), e cada
    // árvore balançando no próprio ritmo (período de 3 a 5 s) com uma vibração fina por cima. Só o alto da copa anda (curva da
    // flexão), proporcional à altura da árvore.
    const vec2 dWind = vec2(${(() => { const y = C.yaw * DEG, px = Math.cos(y), pz = Math.sin(y), fx = Math.sin(y), fz = -Math.cos(y); const x = px * 0.85 + fx * 0.5, z = pz * 0.85 + fz * 0.5, l = Math.hypot(x, z); return (x / l).toFixed(5) + ', ' + (z / l).toFixed(5); })()});
    float windAt(float t, vec2 P, float r) {
      float u = dot(P, dWind), v = dot(P, vec2(-dWind.y, dWind.x));
      float g1 = sin(u * 0.021 - t * 0.13 + sin(v * 0.009 + 1.3) * 2.2);
      float g2 = sin(u * 0.047 - t * 0.31 + sin(v * 0.017) * 1.5 + 1.7);
      float g3 = sin(u * 0.0063 - t * 0.041 + sin(v * 0.004) * 1.2 + 4.1);
      float gust = clamp(0.55 + 0.3 * g1 + 0.2 * g2 + 0.25 * g3, 0., 1.); gust *= gust;   // v2 (pedido: "tá sutil até demais"): venta mais tempo
      float w = mix(1.25, 2.1, fract(r * 23.7));
      return gust * (0.6 + 0.4 * sin(t * w + r * 61.)) + 0.1 * sin(t * mix(3.1, 4.3, fract(r * 5.9)) + r * 17.) * (0.3 + gust);
    }
    void main(){
      { vec2 fwc = vec2(${Math.sin(C.yaw * DEG).toFixed(6)}, ${(-Math.cos(C.yaw * DEG)).toFixed(6)}); vec2 relc = iPos.xz - camRef.xz;
        vRF = smoothstep(20., 120., dot(relc, vec2(-fwc.y, fwc.x))) * (1. - smoothstep(2600., 3200., dot(relc, fwc))); vRFh = vRF * smoothstep(650., 1100., length(relc)); vDbg = vec3(vRF, length(relc) / 2500., iPos.y / 200.); }   // mata da margem direita (pra cor); vRFh: encosta acima
      float thin = step(100., iAttr.x); float h = iAttr.x - 100. * thin, r = iAttr.y; float a = r*6.2831;   // h > 100: pinheirinho fino do contorno (parte 2)
      vec3 p = position; p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
      float tile = floor(r*8.);   // cartão novo: 8 variantes (tools/make_tree_atlas.py)
      float flip = step(0.5, fract(r * 7.77));                      // passo 13: metade espelhada (dobra as silhuetas)
      vUv = vec2((tile + mix(uv.x, 1. - uv.x, flip))*0.125, uv.y);
      // balanço quase imperceptível, irregular
      float s = sin(time*0.45 + r*40. + iPos.x*0.013)*0.6 + sin(time*0.83 + r*17. + iPos.z*0.011)*0.4;
      float gust = 0.5 + 0.5*sin(time*0.07 + iPos.x*0.002);
      p.x += s * 0.0045 * gust * p.y*p.y;
      float dCam = length(iPos.xz - camRef.xz); vFar = smoothstep(900., 2000., dCam);
      float nr = iAttr.w < -0.5 ? 1. - smoothstep(2600., 3400., dCam) : 0.;
      vBand = vec2(smoothstep(40., 170., iPos.y) * nr, nr);   // faixa da ponta do penhasco: alto da mata mais claro (foto #2C2E26 em cima, #20211B na água)
      float wk = mix(0.40, 0.22, thin) * mix(1., mix(2.05, 1.0, position.y), vFar); wk *= mix(0.78, 1.28, fract(r * 53.13));
      // redo, peça floresta (?oldmata volta): margem direita mais alta e de ponta fina, mais alta perto da água
      if (${Q.has('oldmata') ? 'false' : 'true'}) { vec2 fw2 = vec2(${Math.sin(C.yaw * DEG).toFixed(6)}, ${(-Math.cos(C.yaw * DEG)).toFixed(6)}); vec2 rel = iPos.xz - camRef.xz;
        float rf = smoothstep(20., 120., dot(rel, vec2(-fw2.y, fw2.x))) * (1. - smoothstep(1300., 1900., dot(rel, fw2))) * step(dCam, 1900.);
        float nearW = 1. - smoothstep(0., 60., iPos.y);
        h *= 1. + rf * (0.05 + 0.07 * nearW) * mix(0.4, 1.6, fract(r * 91.7)) * smoothstep(250., 600., dCam); wk *= 1. - 0.22 * rf;
        h *= mix(1., mix(0.7, 1.06, fract(r * 41.3)), rf); wk *= mix(1., mix(0.8, 1.35, fract(r * 77.1)), rf); }   // volta 3: alturas bem variadas, topo irregular   // volta 2: alta só um pouco (a v05 passou da linha da foto), ponta fina
      if (${Q.has('oldmataesq') ? 'false' : 'true'}) {
        // pedido ("essa parte inteira precisa de ajustes"): na foto o leque da esquerda desce até a água e a mata fica só na beira
        // esquerda. Árvore cuja base cai dentro do cascalho medido na foto (tools/fan_edges.py, convertido pro quadro da CAM_FOTO) sai
        vec3 rdT = iPos - camRef; float zfT = max(dot(rdT, refF), 1.);
        float Xt = 1000. + refFoc * dot(rdT, refR) / zfT, Yt = 666.5 - refFoc * dot(rdT, refU) / zfT;
        float xl = Yt < 594. ? 792. : (Yt < 636. ? mix(792., 814., (Yt - 594.) / 42.) : (Yt < 677. ? mix(814., 840., (Yt - 636.) / 41.) : (Yt < 698. ? mix(840., 864., (Yt - 677.) / 21.) : (Yt < 709. ? mix(864., 900., (Yt - 698.) / 11.) : mix(900., 949., (Yt - 709.) / 10.)))));
        float xr = Yt < 661. ? 1100. : mix(1077., 1017., (Yt - 661.) / 61.);
        if (Yt > 520. && Yt < 722. && Xt > xl + 3. && Xt < xr - 3.) h = 0.;
        // pedido ("arruma só isso aqui", vista x 618-807, y 633-786): à direita do leque da esquerda a foto tem uma faixa baixa de
        // pedregulho na beira da água e a mata só acima dela (linha da vista (640,715) (744,735) (830,740)); aqui uns pinheiros
        // grandes soltos ficavam plantados na faixa. Árvore com base abaixo da linha sai (?oldbeira volta)
        if (${Q.has('oldbeira') ? 'false' : 'true'} && Xt > 612. && Xt < 770.) {
          float lnB = Xt < 733.3 ? mix(712.8, 733.6, (Xt - 625.) / 108.3) : mix(733.6, 738.8, (Xt - 733.3) / 89.6);
          if (Yt > lnB + 2.) h = 0.;
        }
        // pedido ("acampou do nada"): os pinheirinhos finos espalhados no meio da encosta da esquerda liam como barracas pretas.
        // Na foto só há uns poucos pinheiros altos perto da água no canto de baixo (x < 140, y > 700)
        if (thin > 0.5 && Xt < 360. && Yt > 520. && Yt < 800. && !(Xt < 60. && Yt > 700.)) h = 0.;   // v2: só a coluna da beirada esquerda fica
        if (thin > 0.5 && Xt < 140. && Yt > 700.) wk *= 1.75;   // os que ficam (como na foto) com copa de abeto, não espinho preto
        else if (thin > 0.5 && ${Q.has('oldespinho') ? 'false' : 'true'}) wk *= 1.6;   // erro 56: pinheirinhos finos de contorno liam como espinhos pretos
      }
      if (${Q.has('oldmata') ? 'false' : 'true'}) wk *= mix(1., 1.6, vRFh);   // medido: buracos entre copas encosta acima (densidade 0,84 x 0,98 na foto)
      if (${Q.has('oldborda2') ? 'false' : 'true'}) {   // árvores da crista do paredão que ficavam no céu depois do recorte da borda
        vec3 rdE = iPos - camRef; float zfE = max(dot(rdE, refF), 1.);
        float xvE = 1000. + 0.96 * refFoc * dot(rdE, refR) / zfE, yvE = 669.8 - 0.96 * refFoc * dot(rdE, refU) / zfE, tE = yvE / 10.;
        if (tE > -3. && tE < 34.) { int iE = int(floor(max(tE, 0.))); float eE = mix(wallE[iE], wallE[min(iE + 1, 34)], fract(max(tE, 0.)));
          if (xvE > eE - 3.) h = 0.; }
      }
      if (${Q.has('oldtopomata') ? 'false' : 'true'}) {
        // jogo dos erros (bloco 1320-1360 x 640-680): no começo da mata da direita a foto mostra cascalho claro até ~680 e a mata
        // começa mais baixo (topo medido com tools/forest_line.py: aqui 20 a 31 px acima). A árvore não passa da linha da foto
        vec3 rdQ = iPos - camRef; float zfQ = max(dot(rdQ, refF), 1.);
        float XQ = 1000. + refFoc * dot(rdQ, refR) / zfQ, YQ = 666.5 - refFoc * dot(rdQ, refU) / zfQ;
        if (XQ > 1160. && XQ < 1500.) {
          float lnQ = XQ < 1229. ? 668.8 : (XQ < 1260. ? mix(668.8, 683.4, (XQ - 1229.) / 31.) : (XQ < 1354. ? mix(683.4, 677.1, (XQ - 1260.) / 94.) : (XQ < 1385. ? mix(677.1, 660.5, (XQ - 1354.) / 31.) : (XQ < 1417. ? mix(660.5, 645.9, (XQ - 1385.) / 32.) : mix(645.9, 641.7, (XQ - 1417.) / 62.)))));
          lnQ = min(lnQ, mix(656., 700., smoothstep(1360., 1400., XQ)));   // v2: até x ~1370 a mata ainda cobre a faixa rosa de outra peça (borda reta)
          lnQ += (fract(r * 31.7) - 0.5) * 9.;
          float hMax = max(YQ - lnQ, 0.) * zfQ / refFoc;
          float fadeQ = smoothstep(1160., 1180., XQ) * (1. - smoothstep(1470., 1500., XQ));
          h = mix(h, min(h, hMax), fadeQ);
        }
      }
      vTone = 1.; vSnag = 0.;
      if (${Q.has('oldvariedade') ? 'false' : 'true'} && vRF > 0.1) {
        // revisão (vegetação: "coníferas muito uniformes e alinhadas, parecendo cópias"): na mata da direita cada árvore ganha
        // altura e largura próprias, tom próprio (umas mais escuras: fundo e vão entre copas), falhas em grupo e, bem raro, um
        // tronco seco. Hash pela posição (estável na órbita) (?oldvariedade volta)
        float hA = fract(sin(dot(iPos.xz, vec2(12.9898, 78.233))) * 43758.5453), hB = fract(hA * 31.71 + 0.37), hC = fract(hA * 7.13 + 0.71);
        vec2 gq = iPos.xz / 38.; vec2 gi = floor(gq), gf = fract(gq); gf = gf * gf * (3. - 2. * gf);
        float n00 = fract(sin(dot(gi, vec2(127.1, 311.7))) * 43758.5453), n10 = fract(sin(dot(gi + vec2(1., 0.), vec2(127.1, 311.7))) * 43758.5453);
        float n01 = fract(sin(dot(gi + vec2(0., 1.), vec2(127.1, 311.7))) * 43758.5453), n11 = fract(sin(dot(gi + vec2(1., 1.), vec2(127.1, 311.7))) * 43758.5453);
        float gN = mix(mix(n00, n10, gf.x), mix(n01, n11, gf.x), gf.y);                       // ruído de grupo (~40 m)
        h *= mix(0.86, 1.14, hB) * mix(0.9, 1.06, gN);
        wk *= mix(0.82, 1.22, hC);
        if (gN > 0.8 && hA < 0.45) h = 0.;                                                    // falhas em grupo
        vTone = mix(0.72, 1.1, hA) * mix(0.9, 1.04, gN);
        if (hA > 0.9935) { vSnag = 1.; wk *= 0.4; h *= 0.92; }                               // tronco seco, raro
      }
      p *= vec3(h*wk, h, h*wk); p.x += p.y * (fract(r * 13.37) - 0.5) * 0.07;   // passo 13: largura e inclinação leve por árvore
      if (${Q.has('semvento') ? 'false' : 'true'} && position.y > 0.5) {   // a base do cartão (y = 0) não anda: só os vértices de cima calculam
        // vento (?semvento desliga): deslocamento medido a partir da pose de repouso (vento em t menos vento em 0), então no
        // instante zero a mata está exatamente onde estava. v2 ("tá sutil até demais, nem percebi"): topo de uma árvore de 25 m
        // anda ~1 m no normal e até ~3 m na rajada (a 500 m isso é de 3 a 9 px na tela)
        float wd = windAt(time, iPos.xz, r) - windAt(0., iPos.xz, r);
        p.xz += dWind * wd * 0.11 * h * position.y * position.y;
      }   // longe: base larga (fecha os buracos), ponta fina (borda serrilhada)   // vegetação: longe, copas mais largas que se encostam   // copas mais largas: se tocam, sem pente; contorno: fino
      vec4 wp = vec4(iPos + p, 1.); vP = wp.xyz; vA = iAttr; vY = position.y;
      gl_Position = projectionMatrix*viewMatrix*wp;
    }`,
    fragmentShader: GLSL_COMMON + HAZE_GLSL + `
    uniform sampler2D tSpruce; uniform vec3 cTree, cTreeLit, cTreeFar; uniform float clipY, aaT;
    varying vec2 vUv; varying vec4 vA; varying vec3 vP; varying float vY; varying float vFar; varying vec2 vBand; varying float vRF; varying float vRFh; varying vec3 vDbg; varying float vTone, vSnag;
    void main(){
      if (vP.y < clipY) discard;
      vec4 t = texture2D(tSpruce, vUv);
      if (t.a < (aaT > 0.5 ? 0.12 : 0.5) + vSnag * 0.35) discard;   // tronco seco: copa rala   // passo 2: com alpha to coverage a borda do recorte vira cobertura parcial (MSAA)
      vec3 tc = toLin(t.rgb / max(t.a, 0.35)) / vec3(0.0063, 0.00988, 0.0021);   // cartão novo v2: média 0,48/0,45/0,54 do antigo (medida), 13% mais escuro no geral   // defeito 4: desfaz o escurecimento do mip na borda do recorte (sem halo)
      tc = mix(vec3(1.), tc, mix(0.45, 0.36, vFar));   // longe: textura da copa visível, sem salpicar
      float tv = fract(vA.y * 91.7);
      vec3 col = cTree * tc * (0.8 + 0.4*vA.z) * (0.85 + 0.3*vY) * (0.85 + 0.3 * tv) * mix(vec3(1.0), vec3(0.9, 1.08, 0.95), step(0.6, fract(vA.y * 37.1)));
      col = mix(col, cTreeLit * tc, clamp(max(vA.w, 0.) * vY * 0.3, 0., 1.) * (1. - 0.92 * vFar));   // cartão novo: lado aceso mais fraco (a borda já vem clara no cartão)
      col *= vA.w < -1.5 ? vec3(0.7, 0.72, 0.68) * (0.75 + 0.5 * fract(vA.y * 17.3)) : (vA.w < -0.5 ? vec3(0.74, 0.72, 0.68) : vec3(0.74, 0.72, 0.58));   // faixa da ponta: sem amarelo (foto 35,34,29, nossa 32,35,24)
   // floresta escura; mata da ponta do penhasco neutra e variada (foto #1F211A)
      col = mix(col, cTreeLit * tc, smoothstep(0.72, 1.0, vY) * 0.08 * (1. - 0.9 * vFar));   // cartão novo: ponta quase sem brilho (foto: copas quase pretas)   // pontas um pouco mais claras, verde amarelado (#3a4426)
      col = mix(col, cTreeFar * (0.78 + 0.44 * tv) * (0.8 + 0.35 * vY) * mix(vec3(1.), tc, 0.5), (vA.w < -0.5 ? 0.18 : 0.55) * vFar);   // encosta da esquerda: menos névoa (foto mais escura ali)   // longe: véu cinza da distância, mantendo copa por copa (foto: morro #2F3229)
      if (${Q.has('oldmata') ? 'false' : 'true'}) { col *= mix(0.55, 1.05, smoothstep(0.0, 0.45, vY)) * (1. - 0.6 * vFar) + 0.6 * vFar * 1.; col = mix(col, cTreeLit * tc * 1.2, smoothstep(0.8, 0.98, vY) * 0.12 * (1. - vFar)); col *= mix(vec3(0.72, 0.82, 0.92), vec3(1.), vFar); col *= mix(vec3(0.98, 1.16, 1.0), vec3(1.), vFar); }   // harmonizador: sombra da mata verde escura, não marrom preta   // volta 4: verde quase preto azulado, ponta só um toque   // volta 3: ponta mais clara, volume por árvore   // redo floresta: base da copa em sombra (fresta escura entre árvores), perto
      col *= vTone;
      col = mix(col, vec3(0.034, 0.03, 0.026) * (0.8 + 0.4 * vY), vSnag * 0.85);   // tronco seco: cinza amarronzado escuro
      col = applyHaze(col, vP);
      if (${Q.has('treedbg') ? 'true' : 'false'}) { gl_FragColor = vec4(vDbg, 1.); return; }
      if (${Q.has('oldmata') ? 'false' : 'true'}) {
        // medido (v58): mata da direita encosta acima 30 a 38% clara (foto 37,37,23 x 48,51,32); perto da água falta vermelho (29 x 19)
        col *= mix(vec3(1.), vec3(0.5, 0.45, 0.45), vRFh);
        col *= mix(vec3(1.), vec3(1.6, 1.12, 1.1), vRF * (1. - smoothstep(0., 0.3, vFar)) * (1. - smoothstep(0.15, 0.5, vY)));
      }
      col *= mix(vec3(1.), vec3(1.0, 0.88, 1.28), vBand.y) * (1. + 1.1 * vBand.x * (0.75 + 0.5 * fract(vA.y * 23.7)));   // faixa da ponta do penhasco, depois do véu: cinza esverdeado da foto (35,34,29), alto da mata mais claro (44,46,38)
      gl_FragColor = vec4(col, aaT > 0.5 ? smoothstep(0.25, 0.75, t.a) : 1.);
    }`,
  });
  m.alphaToCoverage = U.aaT.value > 0.5;
  trees = new THREE.Mesh(g, m); trees.frustumCulled = false; scene.add(trees);
}

/* ---------- pedras e pinheiros da margem esquerda em malha (Poly Haven), assentados pelo auditor ---------- */
function buildProps() {
  if (!window.D_PROPS_GLB || !window.D_PROPS || Q.has('noprops')) return;
  scene.add(new THREE.HemisphereLight(0xc9b8c8, 0x4a3e36, 0.95));
  const key = new THREE.DirectionalLight(0xffd6cc, 0.55); key.position.set(0.55, 0.42, -0.72); scene.add(key);
  const bin = B64(window.D_PROPS_GLB); window.D_PROPS_GLB = null;
  new THREE.GLTFLoader().parse(bin.buffer, '', g => {
    g.scene.updateMatrixWorld(true);
    const find = n => { let f = g.scene.getObjectByName(n); if (!f) g.scene.traverse(o => { if (!f && o.name.indexOf(n) === 0) f = o; }); return f; };
    const add = (proto, x, y, z, sxy, sz, rot) => {
      if (!proto) return; const m = proto.clone(true); m.position.set(x, z, -y); m.rotation.set(0, rot, 0); m.scale.set(sxy, sz, sxy);
      m.traverse(o => { if (o.material) { o.material = o.material.clone(); o.material.side = THREE.DoubleSide; if (o.material.map) o.material.alphaTest = 0.45; } });
      scene.add(m); (window.__props = window.__props || []).push(m); return m;
    };
    for (const r of window.D_PROPS.rocks) {
      const pr = find(r.kind); const s = r.s / 1.8; const m = add(pr, r.x, r.y, r.z, s, s * (0.75 + 0.3 * ((r.rot * 7.1) % 1)), r.rot);
      if (m && r.pitted) m.traverse(o => { if (o.material) { o.material.map = T.pitted; T.pitted.encoding = THREE.sRGBEncoding; o.material.needsUpdate = true; } });
    }
    // pedido ("quero isso com geometria realista"): pedregulho de verdade nas faixas da foto (borda direita do leque, pé do paredão,
    // bordas do caminho de areia, divisa com a encosta). Posições do tools/gen_rubble.py (raio da CAM_FOTO até o chão no Blender);
    // pedra afundada um terço no chão, pra não flutuar (?norubble tira)
    if (!Q.has('norubble')) for (const r of (window.D_PROPS.rubble || [])) {
      const pr = find(r.kind); const s = r.s / 1.8;
      const m = add(pr, r.x, r.y, r.z - r.s * 0.3, s, s * (0.55 + 0.35 * ((r.rot * 5.3) % 1)), r.rot);
      if (m && r.kind === 'boulder') m.traverse(o => { if (o.material) { o.material.map = T.pitted; T.pitted.encoding = THREE.sRGBEncoding; o.material.needsUpdate = true; } });
      if (m) m.traverse(o => { if (o.material && o.material.color) o.material.color.multiply(new THREE.Color(0.82, 0.76, 0.72)); });   // tom do pedregulho da foto
    }
    // passo 7: pinheiros da encosta finos e de alturas diferentes; na foto só uns poucos perto da água (x < 130 no quadro)
    const vq = new THREE.Vector3();
    for (const p of window.D_PROPS.pines) {
      vq.set(p.x, p.z, -p.y).project(camera); const X = (vq.x * 0.5 + 0.5) * 2000;
      const hsh = Math.abs(Math.sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453) % 1;
      if (X > 130 && hsh > 0.25) continue;
      // pedido ("acampou do nada"): os pinheirinhos achatados no meio da encosta liam como barracas pretas. Na foto só há uns poucos
      // pinheiros altos perto da água, no canto de baixo à esquerda: ficam só esses, mais largos e verde escuro (?oldbarraca volta)
      const Yv = (0.5 - vq.y * 0.5) * 1333;
      if (!Q.has('oldbarraca') && (X > 60 || Yv < 700)) continue;
      const pr = find('sapling'); const sz = p.h / 5.94 * (0.8 + 0.6 * hsh);
      const pm = add(pr, p.x, p.y, p.z, sz * (Q.has('oldbarraca') ? 0.24 : 0.42), sz, p.rot);
      if (pm && !Q.has('oldbarraca')) pm.traverse(o => { if (o.material && o.material.color) o.material.color.multiply(new THREE.Color(0.75, 1.0, 0.7)); });
    }
    for (const l of (window.D_PROPS.logs || [])) {   // troncos claros caídos na beira da margem direita
      const m = add(find('trunk'), l.x, l.y, l.z, l.s, l.s, l.rot);
      if (m) m.traverse(o => { if (o.material) { o.material.color.setRGB(1.9, 1.8, 1.65); o.material.needsUpdate = true; } });
    }
  }, e => console.error(e));
}
/* ---------- pós: reflexo e floresta já no HDR, depois bloom leve, CA, vinheta, grão ---------- */
let mainRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const postMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: mainRT.texture }, time: U.time, res: { value: new THREE.Vector2(1, 1) }, exposure: { value: TUNE.exposure }, tmA: U.tmA, tmK: U.tmK },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
  fragmentShader: `
  uniform sampler2D tDiffuse; uniform float time, exposure, tmA, tmK; uniform vec2 res; varying vec2 vUv;
  vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0., 1.); }
  vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(max(c, 0.), vec3(1. / 2.4)) - 0.055, step(0.0031308, c)); }
  float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
  vec3 shoulder(vec3 c){ return mix(c, 1. - 0.4*exp(-(c-0.6)/0.4), step(0.6, c)); }
  vec3 tex(vec2 uv){ return texture2D(tDiffuse, uv).rgb; }
  void main(){
    vec2 cc = vUv - 0.5; float r2 = dot(cc, cc);
    // bloom bem leve: média de vizinhos só do que passa de 0.7
    vec3 base = tex(vUv);
    vec3 bl = vec3(0.); vec2 px = 1./res;
    for (int i=0;i<8;i++){ float a = float(i)*0.785; vec2 o = vec2(cos(a),sin(a))*px*6.; vec3 s = tex(vUv+o); bl += max(s-0.7, 0.); }
    base += bl/8. * 0.25;
    // aberração cromática nas bordas
    float ca = 0.0012 * r2 * 4.;
    vec3 c = vec3(tex(vUv + cc*ca).r, base.g, tex(vUv - cc*ca).b);
    c.g = base.g; c *= exposure;
    if (tmA > 1.5) c = srgb(shoulder(max(c, 0.)));                    // passo 1b: curva antiga (sombras levantadas como na foto) + sRGB exato
    else if (tmA > 0.5) c = srgb(aces(max(c, 0.) * tmK));            // passo 1a: ACES (perdeu 68%: esmaga as sombras)
    else { c = shoulder(c); c = pow(max(c, 0.), vec3(1./2.2)); }
    c *= 1. - 0.14 * smoothstep(0.12, 0.62, r2);   // vinheta sutil
    c += (h(vUv*res + fract(time*7.3)*91.) - 0.5) * 0.022;
    if (tmA > 0.5) c += (h(vUv*res + 17.1 + fract(time*3.1)*57.) + h(vUv*res + 43.7 + fract(time*5.9)*23.) - 1.) / 255.;   // dithering triangular de 1 nível
    gl_FragColor = vec4(c, 1.);
  }`,
  depthTest: false, depthWrite: false,
});
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

function resize() {
  const [vw, vh] = viewSize(); renderer.setSize(vw, vh); setFov();
  const cs = renderer.domElement.style; cs.position = 'absolute'; cs.left = Math.floor((window.innerWidth - vw) / 2) + 'px'; cs.top = Math.floor((window.innerHeight - vh) / 2) + 'px';
  document.body.style.backgroundColor = '#000'; document.body.style.margin = '0'; document.body.style.overflow = 'hidden';   // só a cor: o pôster do carregamento continua
  const pr = renderer.getPixelRatio(), w = Math.floor(vw * pr), h = Math.floor(vh * pr);
  // MSAA no r147: setSize não realoca o buffer multiamostrado e a cena encolhia num canto com o resto preto (tela cheia,
  // janela redimensionada). Recria os dois alvos no tamanho novo.
  if (mainRT.width !== w || mainRT.height !== h) {
    mainRT.dispose(); reflRT.dispose();
    mainRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    reflRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    postMat.uniforms.tDiffuse.value = mainRT.texture; wU.tRefl.value = reflRT.texture;
  }
  wU.reflRes.value.set(w, h);
  postMat.uniforms.res.value.set(w, h);
}
window.addEventListener('resize', resize); resize();

/* ---------- terreno do GLB ---------- */
let ready = false, frames = 0;
// ruído de valor em 3 oitavas (mesmos pesos do fbm3 do shader), periódico em 64 unidades, 16 texels por unidade, no alfa de uma
// cópia do tDark (o shader do terreno já usa 15 dos 16 samplers). Linha 0 do array = base da imagem (o TextureLoader vira a imagem)
function packNoise(t) {
  const img = t.image, W = img.width, H = img.height, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0); const src = cx.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 4), P = 64, tpu = W / P;
  const lat = []; let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let o = 0; o < 3; o++) { const n = P << o, a = new Float32Array(n * n); for (let i = 0; i < n * n; i++) a[i] = rnd(); lat.push(a); }
  const off = [[0, 0], [1.7, 9.2], [5.1, 27.6]];
  const vn = (o, x, y) => { const n = P << o, a = lat[o]; const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((ix % n) + n) % n, y0 = ((iy % n) + n) % n, x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
    const v00 = a[y0 * n + x0], v10 = a[y0 * n + x1], v01 = a[y1 * n + x0], v11 = a[y1 * n + x1];
    return (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy; };
  for (let r = 0; r < H; r++) {
    const sr = (H - 1 - r) * W * 4, dr = r * W * 4, py = (r + 0.5) / tpu;
    for (let c = 0; c < W; c++) {
      const px = (c + 0.5) / tpu;
      const v = 0.5 * vn(0, px, py) + 0.25 * vn(1, px * 2 + off[1][0], py * 2 + off[1][1]) + 0.125 * vn(2, px * 4 + off[2][0], py * 4 + off[2][1]);
      const k = dr + c * 4; out[k] = src[sr + c * 4]; out[k + 1] = src[sr + c * 4 + 1]; out[k + 2] = src[sr + c * 4 + 2]; out[k + 3] = Math.round(v * 255);
    }
  }
  const d = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  d.wrapS = d.wrapT = THREE.RepeatWrapping; d.magFilter = THREE.LinearFilter; d.minFilter = THREE.LinearMipmapLinearFilter; d.generateMipmaps = true; d.anisotropy = 16; d.needsUpdate = true;
  return d;
}
manager.onLoad = () => {
  LT('texturas');
  if (!Q.has('oldnoise')) { tU.tDark.value = packNoise(T.dark); LT('ruido'); }
  const bin = B64(window.D_TERRAIN); window.D_TERRAIN = null; LT('terreno decodificado');
  new THREE.GLTFLoader().parse(bin.buffer, '', gltf => {
    LT('terreno GLB lido');
    gltf.scene.traverse(o => {
      if (o.isMesh) {
        const g = o.geometry; g.setAttribute('acol', g.getAttribute('color'));
        if (g.getAttribute('uv2')) g.setAttribute('buv', g.getAttribute('uv2')); else g.setAttribute('buv', g.getAttribute('uv')); o.material = terrainMat; o.frustumCulled = false;
      }
    });
    scene.add(gltf.scene);
    if (!Q.has('notrees')) buildTrees(); LT('arvores'); buildProps(); LT('props');
    // carregamento (pedido: demorava muito): ~37 s eram a compilação do shader do terreno no D3D, que compilava todos os ramos de
    // teste e depuração ligados por uniform. Os interruptores viram constantes deste carregamento (#define antes do main) e o
    // compilador joga fora os ramos mortos; a imagem não muda (?noconst volta ao antigo)
    if (!Q.has('noconst')) {
      constify(terrainMat, ['dbgF', 'partF', 'fGain', 'partA', 'aGain', 'partB', 'partC', 'partD', 'partE', 'partH', 'partI', 'partJ', 'partK',
        'partN', 'partM', 'dbgP', 'bakePerPx', 'bakeFx', 'useBake', 'useBake2', 'useFloor', 'nearGain', 'strata', 'detail', 'bakeExp', 'tmA', 'tmK', 'partL']);
      constify(postMat, ['tmA', 'tmK', 'exposure']);
      LT('constantes');
    }
    ready = true;
  }, e => console.error(e));
};

// gravação do vídeo (só com ?autoorbit=S na URL, nada muda na página normal): parada por S segundos depois de pronta,
// depois uma órbita lenta até os dois limites e de volta ao centro (16 s), sem cursor na tela
const AUTO = Q.has('autoorbit') ? parseFloat(Q.get('autoorbit') || '20') : null; let tReady = 0;
if (AUTO !== null) document.documentElement.style.cursor = 'none';
function autoOrbit() {
  const s = (performance.now() - tReady) / 1000 - AUTO; if (s <= 0) return;
  const e = x => x * x * (3 - 2 * x), A = -0.038, B = 0.023;
  const da = s < 5 ? A * e(s / 5) : s < 13 ? A + (B - A) * e((s - 5) / 8) : s < 16 ? B * (1 - e((s - 13) / 3)) : 0;
  const dp = s < 16 ? -0.012 * Math.sin(Math.min(s / 16, 1) * Math.PI) : 0;
  const sp = new THREE.Spherical().setFromVector3(camPos0.clone().sub(controls.target)); sp.theta += da; sp.phi += dp;
  camera.position.setFromSpherical(sp).add(controls.target);
}
function constify(mat, names) {
  const fs = mat.fragmentShader, i = fs.lastIndexOf('void main(');
  if (i < 0) return;
  const fl = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));
  const defs = names.filter(n => mat.uniforms[n] && typeof mat.uniforms[n].value === 'number').map(n => `#define ${n} ${fl(mat.uniforms[n].value)}`);
  mat.fragmentShader = fs.slice(0, i) + defs.join('\n') + '\n' + fs.slice(i); mat.needsUpdate = true;
}
const clock = new THREE.Clock();
function frame() {
  requestAnimationFrame(frame);
  if (!ready) return;
  U.time.value = FIXED_T !== null ? FIXED_T : clock.getElapsedTime() + 40.0;
  if (!SHOT) controls.update();
  if (AUTO !== null) { if (!tReady) tReady = performance.now(); autoOrbit(); }
  camera.lookAt(controls.target); camera.rotateZ(ROLL); camera.updateMatrixWorld();
  sky.position.copy(camera.position);
  if (frames === 0 && Q.has('ctime')) {   // medida (só com ?ctime): tempo de compilação de cada material, um por vez
    const objs = []; scene.traverse(o => { if (o.material) objs.push(o); });
    for (const o of objs) { const s = new THREE.Scene(); s.add(new THREE.Mesh(o.geometry, o.material)); const t0 = performance.now(); renderer.compile(s, camera); console.log('CTIME ' + (o.name || '-') + ' ' + o.material.type + ' ' + (o === sky ? 'sky' : o === water ? 'water' : o === trees ? 'trees' : o.material === terrainMat ? 'terrain' : '?') + ' ' + Math.round(performance.now() - t0) + ' ms'); }
    const t1 = performance.now(); renderer.compile(postScene, postCam); console.log('CTIME post ' + Math.round(performance.now() - t1) + ' ms');
  }
  renderReflection();
  renderer.setRenderTarget(mainRT); renderer.clear(); renderer.render(scene, camera);
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
  if (frames === 0) LT('primeiro quadro (com shaders)');
  // carregamento: o pôster (print da nossa própria cena na view padrão) cobre a espera; o canvas entra por cima no 2º quadro
  if (frames === 1) { const cv = renderer.domElement; if (SHOT || FIXED_T !== null) cv.style.transition = 'none'; cv.style.opacity = '1'; }
  if (++frames === 4) { window.__ready = true; document.title = 'READY'; LT('quadro 4'); if (Q.has('coldtest')) window.__dbg = { scene, renderer, camera }; }
  if (FPSLOG && Q.has('fpssync')) renderer.getContext().readPixels(0, 0, 1, 1, 6408, 5121, fpsPx);   // espera a placa terminar o quadro
  if (FPSLOG) fpsTick();
}
// teste de desempenho (só com ?fpslog na URL, nada na tela): mede 600 quadros depois de 120 de aquecimento e escreve no console;
// com ?fpsorbit a câmera varre os limites da órbita durante a medida
const FPSLOG = Q.has('fpslog'); let fpsLast = 0; const fpsD = [], fpsPx = new Uint8Array(4);
function fpsTick() {
  const t = performance.now();
  if (frames > 120) {
    if (Q.has('fpsorbit')) {
      const k = (frames - 120) / 600, sp = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
      sp.theta = az0 + (k < 0.5 ? -0.04 + 0.13 * k : 0.025 - 0.13 * (k - 0.5)); sp.phi = po0 + 0.095 * Math.sin(k * 6.283) - 0.0225;
      camera.position.setFromSpherical(sp).add(controls.target);
    }
    fpsD.push(t - fpsLast);
    if (fpsD.length === 600) {
      const d = fpsD.slice().sort((a, b) => a - b), avg = d.reduce((a, b) => a + b, 0) / d.length;
      console.log('FPSLOG avg ' + (1000 / avg).toFixed(1) + ' p95ms ' + d[570].toFixed(1) + ' worstms ' + d[599].toFixed(1) + ' canvas ' + renderer.domElement.width + 'x' + renderer.domElement.height + ' trees ' + (trees ? trees.geometry.instanceCount : 0));
    }
  }
  fpsLast = t;
}
frame();
})();
