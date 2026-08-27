// @ts-nocheck
import { SAMPLE_B64 } from './sample-part';

function parseSTL(buf){
  const dv=new DataView(buf);
  if(buf.byteLength>=84){
    const n=dv.getUint32(80,true);
    if(84+n*50===buf.byteLength) return parseBinary(dv,n);
  }
  return parseASCII(new TextDecoder().decode(new Uint8Array(buf)));
}
function parseBinary(dv,n){
  const t=new Float64Array(n*9);
  let o=84;
  for(let i=0;i<n;i++){
    o+=12; // skip stored normal, we recompute
    for(let k=0;k<9;k++){ t[i*9+k]=dv.getFloat32(o,true); o+=4; }
    o+=2;
  }
  return t;
}
function parseASCII(s){
  const nums=[]; const re=/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g; let m;
  while((m=re.exec(s))) nums.push(+m[1],+m[2],+m[3]);
  const n=Math.floor(nums.length/9);
  return Float64Array.from(nums.slice(0,n*9));
}

/* ============================================================
   2. Mesh: weld vertices, build faces + edge adjacency
   ============================================================ */
function buildMesh(tri){
  const nf=tri.length/9;
  let mn=[Infinity,Infinity,Infinity], mx=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<tri.length;i+=3)
    for(let k=0;k<3;k++){ const v=tri[i+k]; if(v<mn[k])mn[k]=v; if(v>mx[k])mx[k]=v; }
  const diag=Math.hypot(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2])||1;
  const eps=diag*1e-6;

  const map=new Map(), verts=[];
  const face=new Int32Array(nf*3);
  for(let f=0;f<nf;f++) for(let c=0;c<3;c++){
    const b=f*9+c*3, x=tri[b],y=tri[b+1],z=tri[b+2];
    const key=Math.round(x/eps)+","+Math.round(y/eps)+","+Math.round(z/eps);
    let id=map.get(key);
    if(id===undefined){ id=verts.length/3; map.set(key,id); verts.push(x,y,z); }
    face[f*3+c]=id;
  }
  const V=Float64Array.from(verts);

  const fn=new Float64Array(nf*3), fa=new Float64Array(nf), fc=new Float64Array(nf*3);
  for(let f=0;f<nf;f++){
    const a=face[f*3]*3,b=face[f*3+1]*3,c=face[f*3+2]*3;
    const ux=V[b]-V[a],uy=V[b+1]-V[a+1],uz=V[b+2]-V[a+2];
    const vx=V[c]-V[a],vy=V[c+1]-V[a+1],vz=V[c+2]-V[a+2];
    let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const L=Math.hypot(nx,ny,nz);
    fa[f]=L/2;
    if(L>1e-14){ nx/=L; ny/=L; nz/=L; }
    fn[f*3]=nx; fn[f*3+1]=ny; fn[f*3+2]=nz;
    fc[f*3]=(V[a]+V[b]+V[c])/3; fc[f*3+1]=(V[a+1]+V[b+1]+V[c+1])/3; fc[f*3+2]=(V[a+2]+V[b+2]+V[c+2])/3;
  }

  const em=new Map(), edges=[];
  for(let f=0;f<nf;f++) for(let c=0;c<3;c++){
    const i=face[f*3+c], j=face[f*3+(c+1)%3];
    const key=i<j?i+"_"+j:j+"_"+i;
    let e=em.get(key);
    if(e===undefined){ e=edges.length; em.set(key,e); edges.push({a:Math.min(i,j),b:Math.max(i,j),f1:f,f2:-1}); }
    else if(edges[e].f2<0) edges[e].f2=f;
  }
  const faceEdges=Array.from({length:nf},()=>[]);
  for(let e=0;e<edges.length;e++){
    faceEdges[edges[e].f1].push(e);
    if(edges[e].f2>=0) faceEdges[edges[e].f2].push(e);
  }

  let vol=0;
  for(let f=0;f<nf;f++){
    const a=face[f*3]*3,b=face[f*3+1]*3,c=face[f*3+2]*3;
    vol+=(V[a]*(V[b+1]*V[c+2]-V[b+2]*V[c+1])
        - V[a+1]*(V[b]*V[c+2]-V[b+2]*V[c])
        + V[a+2]*(V[b]*V[c+1]-V[b+1]*V[c]))/6;
  }
  let area=0; for(let f=0;f<nf;f++) area+=fa[f];
  let openEdges=0; for(const e of edges) if(e.f2<0) openEdges++;

  return {V,face,fn,fa,fc,edges,faceEdges,nf,mn,mx,diag,
          volume:Math.abs(vol),area,openEdges,watertight:openEdges===0};
}

/* ============================================================
   3. Segmentation into smooth patches
   ============================================================ */
function segment(M,degThresh){
  const cosT=Math.cos(degThresh*Math.PI/180);
  const patchOf=new Int32Array(M.nf).fill(-1);
  const patches=[];
  const stack=[];
  for(let s=0;s<M.nf;s++){
    if(patchOf[s]>=0) continue;
    const id=patches.length, list=[];
    patchOf[s]=id; stack.length=0; stack.push(s);
    while(stack.length){
      const f=stack.pop(); list.push(f);
      for(const e of M.faceEdges[f]){
        const E=M.edges[e]; const g=E.f1===f?E.f2:E.f1;
        if(g<0||patchOf[g]>=0) continue;
        const d=M.fn[f*3]*M.fn[g*3]+M.fn[f*3+1]*M.fn[g*3+1]+M.fn[f*3+2]*M.fn[g*3+2];
        if(d>=cosT){ patchOf[g]=id; stack.push(g); }
      }
    }
    patches.push(list);
  }
  return {patches,patchOf};
}

/* ============================================================
   Geometry engine — primitive extraction from a triangle mesh
   ============================================================ */

/* ---------- linear algebra ---------- */
function eigen3(A){
  const a=[A[0].slice(),A[1].slice(),A[2].slice()];
  let V=[[1,0,0],[0,1,0],[0,0,1]];
  for(let sweep=0;sweep<32;sweep++){
    const off=a[0][1]**2+a[0][2]**2+a[1][2]**2;
    if(off<1e-26) break;
    for(let p=0;p<2;p++) for(let q=p+1;q<3;q++){
      if(Math.abs(a[p][q])<1e-22) continue;
      const th=(a[q][q]-a[p][p])/(2*a[p][q]);
      const t=(th>=0?1:-1)/(Math.abs(th)+Math.sqrt(th*th+1));
      const c=1/Math.sqrt(t*t+1), s=t*c;
      for(let k=0;k<3;k++){ const kp=a[k][p],kq=a[k][q]; a[k][p]=c*kp-s*kq; a[k][q]=s*kp+c*kq; }
      for(let k=0;k<3;k++){ const pk=a[p][k],qk=a[q][k]; a[p][k]=c*pk-s*qk; a[q][k]=s*pk+c*qk; }
      for(let k=0;k<3;k++){ const kp=V[k][p],kq=V[k][q]; V[k][p]=c*kp-s*kq; V[k][q]=s*kp+c*kq; }
    }
  }
  const val=[a[0][0],a[1][1],a[2][2]];
  const idx=[0,1,2].sort((i,j)=>val[i]-val[j]);
  return {values:idx.map(i=>val[i]), vectors:idx.map(i=>[V[0][i],V[1][i],V[2][i]])};
}
function solveN(m,r){                       // m: n x n, r: length n
  const N=r.length, A=m.map((row,i)=>row.concat([r[i]]));
  for(let i=0;i<N;i++){
    let p=i; for(let k=i+1;k<N;k++) if(Math.abs(A[k][i])>Math.abs(A[p][i])) p=k;
    if(Math.abs(A[p][i])<1e-14) return null;
    [A[i],A[p]]=[A[p],A[i]];
    for(let k=i+1;k<N;k++){ const f=A[k][i]/A[i][i]; for(let j=i;j<=N;j++) A[k][j]-=f*A[i][j]; }
  }
  const x=new Array(N).fill(0);
  for(let i=N-1;i>=0;i--){ let s=A[i][N]; for(let j=i+1;j<N;j++) s-=A[i][j]*x[j]; x[i]=s/A[i][i]; }
  return x;
}
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return [a[0]/L,a[1]/L,a[2]/L];};

/* ---------- helpers ---------- */
function vertsOf(M,faces){
  const seen=new Set(), out=[];
  for(const f of faces) for(let c=0;c<3;c++){
    const i=M.face[f*3+c];
    if(seen.has(i)) continue; seen.add(i);
    out.push([M.V[i*3],M.V[i*3+1],M.V[i*3+2]]);
  }
  return out;
}
function areaOf(M,faces){ let a=0; for(const f of faces) a+=M.fa[f]; return a; }
function extentOf(P){
  let mn=[1e30,1e30,1e30], mx=[-1e30,-1e30,-1e30];
  for(const p of P) for(let i=0;i<3;i++){ if(p[i]<mn[i])mn[i]=p[i]; if(p[i]>mx[i])mx[i]=p[i]; }
  return Math.hypot(mx[0]-mn[0],mx[1]-mn[1],mx[2]-mn[2]);
}

/* ---------- primitive fits ---------- */
function fitPlaneP(M,faces){
  let A=0,n=[0,0,0],c=[0,0,0];
  for(const f of faces){
    const w=M.fa[f]; if(!(w>0)) continue; A+=w;
    for(let i=0;i<3;i++){ n[i]+=w*M.fn[f*3+i]; c[i]+=w*M.fc[f*3+i]; }
  }
  if(A<=0||len(n)<1e-9) return null;
  n=norm(n); c=c.map(v=>v/A);
  return {type:"plane",n,d:dot(c,n),centroid:c,area:A};
}
function fitSphereP(M,faces){
  const P=vertsOf(M,faces);
  if(P.length<8) return null;
  const m=[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], r=[0,0,0,0];
  for(const p of P){
    const row=[p[0],p[1],p[2],1], q=-(p[0]*p[0]+p[1]*p[1]+p[2]*p[2]);
    for(let i=0;i<4;i++){ for(let j=0;j<4;j++) m[i][j]+=row[i]*row[j]; r[i]+=row[i]*q; }
  }
  const s=solveN(m,r); if(!s) return null;
  const c=[-s[0]/2,-s[1]/2,-s[2]/2];
  const rr=dot(c,c)-s[3]; if(!(rr>0)) return null;
  const rad=Math.sqrt(rr);
  if(rad>4*extentOf(P)) return null;        // degenerate: that is a plane
  return {type:"sphere",c,r:rad};
}
function fitCylinderP(M,faces){
  const C=[[0,0,0],[0,0,0],[0,0,0]]; let W=0;
  for(const f of faces){
    const w=M.fa[f]; if(!(w>0)) continue; W+=w;
    const n=[M.fn[f*3],M.fn[f*3+1],M.fn[f*3+2]];
    for(let i=0;i<3;i++) for(let j=0;j<3;j++) C[i][j]+=w*n[i]*n[j];
  }
  if(W<=0) return null;
  for(let i=0;i<3;i++) for(let j=0;j<3;j++) C[i][j]/=W;
  const E=eigen3(C);
  if(E.values[2]<1e-12) return null;
  if(E.values[1]/E.values[2]<0.02) return null;      // that's a plane
  const ax=norm(E.vectors[0]);
  const t=Math.abs(ax[0])<0.9?[1,0,0]:[0,1,0];
  const u=norm(cross(ax,t)), v=cross(ax,u);
  const P=vertsOf(M,faces); if(P.length<6) return null;
  let Sx=0,Sy=0,Sxx=0,Syy=0,Sxy=0,Sz=0,Szx=0,Szy=0;
  for(const p of P){
    const x=dot(p,u), y=dot(p,v), z=x*x+y*y;
    Sx+=x;Sy+=y;Sxx+=x*x;Syy+=y*y;Sxy+=x*y;Sz+=z;Szx+=z*x;Szy+=z*y;
  }
  const s=solveN([[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,P.length]],[-Szx,-Szy,-Sz]);
  if(!s) return null;
  const cx=-s[0]/2, cy=-s[1]/2, rr=cx*cx+cy*cy-s[2];
  if(!(rr>0)) return null;
  const base=[cx*u[0]+cy*v[0],cx*u[1]+cy*v[1],cx*u[2]+cy*v[2]];
  const rad=Math.sqrt(rr);
  if(rad>4*extentOf(P)) return null;        // degenerate: that is a plane
  return {type:"cylinder",axis:ax,base,r:rad,u,v,cx,cy};
}
function fitConeP(M,faces){
  // axis: direction along which n.a is most nearly constant
  let W=0,nb=[0,0,0];
  for(const f of faces){ const w=M.fa[f]; W+=w; for(let i=0;i<3;i++) nb[i]+=w*M.fn[f*3+i]; }
  if(W<=0) return null;
  nb=nb.map(v=>v/W);
  const C=[[0,0,0],[0,0,0],[0,0,0]];
  for(const f of faces){
    const w=M.fa[f], dn=[M.fn[f*3]-nb[0],M.fn[f*3+1]-nb[1],M.fn[f*3+2]-nb[2]];
    for(let i=0;i<3;i++) for(let j=0;j<3;j++) C[i][j]+=w*dn[i]*dn[j];
  }
  for(let i=0;i<3;i++) for(let j=0;j<3;j++) C[i][j]/=W;
  const E=eigen3(C);
  if(E.values[2]<1e-14) return null;
  if(E.values[1]/E.values[2]<0.05) return null;       // normals collinear → plane
  let ax=norm(E.vectors[0]);
  let s=dot(nb,ax);
  if(s>0){ ax=ax.map(v=>-v); s=-s; }
  const half=Math.asin(Math.max(-1,Math.min(1,-s)));
  if(half<0.035||half>1.52) return null;              // ~2°..87°: else cylinder or plane
  // apex q solves  n.(q-p)=0  in least squares
  const m=[[0,0,0],[0,0,0],[0,0,0]], r=[0,0,0];
  for(const f of faces){
    const w=M.fa[f], n=[M.fn[f*3],M.fn[f*3+1],M.fn[f*3+2]];
    const b=w*dot(n,[M.fc[f*3],M.fc[f*3+1],M.fc[f*3+2]]);
    for(let i=0;i<3;i++){ for(let j=0;j<3;j++) m[i][j]+=w*n[i]*n[j]; r[i]+=b*n[i]; }
  }
  const q=solveN(m,r); if(!q) return null;
  return {type:"cone",axis:ax,apex:q,half};
}

/* ---------- distance from a point to a primitive ---------- */
function primDist(P,p){
  if(P.type==="plane") return Math.abs(dot(p,P.n)-P.d);
  if(P.type==="sphere") return Math.abs(len(sub(p,P.c))-P.r);
  if(P.type==="cylinder"){
    const v=sub(p,P.base), t=dot(v,P.axis);
    return Math.abs(Math.hypot(v[0]-t*P.axis[0],v[1]-t*P.axis[1],v[2]-t*P.axis[2])-P.r);
  }
  if(P.type==="cone"){
    const v=sub(p,P.apex), t=dot(v,P.axis);
    const rho=Math.hypot(v[0]-t*P.axis[0],v[1]-t*P.axis[1],v[2]-t*P.axis[2]);
    return Math.abs(rho*Math.cos(P.half)-t*Math.sin(P.half));
  }
  return Infinity;
}
function primNormal(P,p){
  if(P.type==="plane") return P.n;
  if(P.type==="sphere") return norm(sub(p,P.c));
  if(P.type==="cylinder"){
    const v=sub(p,P.base), t=dot(v,P.axis);
    return norm([v[0]-t*P.axis[0],v[1]-t*P.axis[1],v[2]-t*P.axis[2]]);
  }
  if(P.type==="cone"){
    const v=sub(p,P.apex), t=dot(v,P.axis);
    const rh=norm([v[0]-t*P.axis[0],v[1]-t*P.axis[1],v[2]-t*P.axis[2]]);
    const c=Math.cos(P.half), s=Math.sin(P.half);
    return norm([rh[0]*c-P.axis[0]*s, rh[1]*c-P.axis[1]*s, rh[2]*c-P.axis[2]*s]);
  }
  return [0,0,1];
}
function rmsOf(M,faces,P){
  const V=vertsOf(M,faces); if(!V.length) return Infinity;
  let s=0; for(const p of V){ const d=primDist(P,p); s+=d*d; }
  return Math.sqrt(s/V.length);
}
function normErr(M,faces,P){          // mean angular disagreement, area weighted
  let w=0,s=0;
  for(const f of faces){
    const a=M.fa[f]; if(!(a>0)) continue;
    const pn=primNormal(P,[M.fc[f*3],M.fc[f*3+1],M.fc[f*3+2]]);
    const d=Math.abs(M.fn[f*3]*pn[0]+M.fn[f*3+1]*pn[1]+M.fn[f*3+2]*pn[2]);
    s+=a*(1-Math.min(1,d)); w+=a;
  }
  return w>0?s/w:1;
}
function bestPrimitive(M,faces,tol){
  if(faces.length<2) return null;
  const cand=[];
  const add=(p,w)=>{ if(p){ p.rms=rmsOf(M,faces,p); p.nerr=normErr(M,faces,p);
                            if(isFinite(p.rms)) cand.push([p,w]); } };
  add(fitPlaneP(M,faces),1.00);
  add(fitCylinderP(M,faces),1.10);
  add(fitSphereP(M,faces),1.25);
  add(fitConeP(M,faces),1.45);
  let best=null,bs=Infinity;
  const floor=tol*0.05;               // keeps FP noise from deciding between exact fits
  const NMAX=1-Math.cos(11*Math.PI/180);
  for(const [p,w] of cand){
    if(p.rms>tol||p.nerr>NMAX) continue;
    const s=(p.rms+floor)*w*(1+30*p.nerr);
    if(s<bs){ bs=s; best=p; }
  }
  return best;
}

/* ---------- region growing driven by a fitted primitive ---------- */
function faceFits(M,f,P,tol,cosT){
  for(let c=0;c<3;c++){
    const i=M.face[f*3+c];
    if(primDist(P,[M.V[i*3],M.V[i*3+1],M.V[i*3+2]])>tol) return false;
  }
  const pn=primNormal(P,[M.fc[f*3],M.fc[f*3+1],M.fc[f*3+2]]);
  const d=M.fn[f*3]*pn[0]+M.fn[f*3+1]*pn[1]+M.fn[f*3+2]*pn[2];
  return Math.abs(d)>cosT;
}
function growRegion(M,seed,inPatch,used,P,tol){
  const cosT=Math.cos(32*Math.PI/180);
  const seen=new Set([seed]), st=[seed], reg=[];
  while(st.length){
    const f=st.pop();
    if(!faceFits(M,f,P,tol,cosT)) continue;
    reg.push(f);
    for(const e of M.faceEdges[f]){
      const E=M.edges[e], g=E.f1===f?E.f2:E.f1;
      if(g<0||seen.has(g)||used[g]||!inPatch.has(g)) continue;
      seen.add(g); st.push(g);
    }
  }
  return reg;
}
function localBall(M,seed,inPatch,used,n){
  const seen=new Set([seed]), q=[seed], out=[];
  for(let i=0;i<q.length&&out.length<n;i++){
    const f=q[i]; out.push(f);
    for(const e of M.faceEdges[f]){
      const E=M.edges[e], g=E.f1===f?E.f2:E.f1;
      if(g<0||seen.has(g)||used[g]||!inPatch.has(g)) continue;
      seen.add(g); q.push(g);
    }
  }
  return out;
}

/* ---------- extract every primitive in the mesh ---------- */
function extractPrimitives(M,segFn){
  const seg=segFn(M,40);
  M.patchOf=seg.patchOf;
  const tol=M.diag*3e-4, out=[];
  for(const patch of seg.patches){
    const whole=bestPrimitive(M,patch,tol);
    if(whole){ out.push({P:whole,faces:patch,area:areaOf(M,patch)}); continue; }
    // the patch spans more than one shape — carve it up
    const inPatch=new Set(patch);
    const used=new Uint8Array(M.nf), tried=new Uint8Array(M.nf);
    const seeds=patch.slice().sort((a,b)=>M.fa[b]-M.fa[a]);
    for(const s of seeds){
      if(used[s]||tried[s]) continue;
      tried[s]=1;
      const ball=localBall(M,s,inPatch,used,80);
      let P=bestPrimitive(M,ball,tol*1.2);
      if(!P) continue;
      let reg=growRegion(M,s,inPatch,used,P,tol);
      if(reg.length>=12){
        const P2=bestPrimitive(M,reg,tol*2);
        if(P2){ P=P2; reg=growRegion(M,s,inPatch,used,P,tol); }
      }
      if(reg.length<8) continue;
      for(const f of reg) used[f]=1;
      const P3=bestPrimitive(M,reg,tol*3)||P;
      out.push({P:P3,faces:reg,area:areaOf(M,reg)});
    }
  }
  return refine(M,out,tol,3);
}

/* ---------- refinement: reassign every face to its best primitive, refit, repeat ---------- */
function refitSame(M,faces,type){
  if(type==="plane") return fitPlaneP(M,faces);
  if(type==="cylinder") return fitCylinderP(M,faces);
  if(type==="sphere") return fitSphereP(M,faces);
  if(type==="cone") return fitConeP(M,faces);
  return null;
}
function splitByConnectivity(M,faces){
  const inSet=new Set(faces), seen=new Set(), out=[];
  for(const s of faces){
    if(seen.has(s)) continue;
    const comp=[], st=[s]; seen.add(s);
    while(st.length){
      const f=st.pop(); comp.push(f);
      for(const e of M.faceEdges[f]){
        const E=M.edges[e], g=E.f1===f?E.f2:E.f1;
        if(g<0||seen.has(g)||!inSet.has(g)) continue;
        seen.add(g); st.push(g);
      }
    }
    out.push(comp);
  }
  return out;
}
function robustFit(M,faces,type,tol){
  let P=refitSame(M,faces,type); if(!P) return null;
  for(let it=0;it<2;it++){                       // trim outliers, refit
    const keep=[];
    for(const f of faces){
      let ok=true;
      for(let c=0;c<3&&ok;c++){
        const i=M.face[f*3+c];
        if(primDist(P,[M.V[i*3],M.V[i*3+1],M.V[i*3+2]])>tol*0.6) ok=false;
      }
      if(ok) keep.push(f);
    }
    if(keep.length<Math.max(6,faces.length*0.5)||keep.length===faces.length) break;
    const P2=refitSame(M,keep,type); if(!P2) break;
    P=P2;
  }
  P.rms=rmsOf(M,faces,P);
  return P;
}
function refine(M,prims,tol,iters){
  const cosT=Math.cos(30*Math.PI/180);
  for(let it=0;it<iters;it++){
    const owner=new Int32Array(M.nf).fill(-1);
    const score=new Float64Array(M.nf).fill(Infinity);
    for(let k=0;k<prims.length;k++){
      const P=prims[k].P; if(!P) continue;
      for(let f=0;f<M.nf;f++){
        let d=0;
        for(let c=0;c<3;c++){
          const i=M.face[f*3+c];
          const dd=primDist(P,[M.V[i*3],M.V[i*3+1],M.V[i*3+2]]);
          if(dd>d) d=dd;
          if(d>tol) break;
        }
        if(d>tol||d>=score[f]) continue;
        const pn=primNormal(P,[M.fc[f*3],M.fc[f*3+1],M.fc[f*3+2]]);
        if(Math.abs(M.fn[f*3]*pn[0]+M.fn[f*3+1]*pn[1]+M.fn[f*3+2]*pn[2])<cosT) continue;
        score[f]=d; owner[f]=k;
      }
    }
    const buckets=prims.map(()=>[]);
    for(let f=0;f<M.nf;f++) if(owner[f]>=0) buckets[owner[f]].push(f);
    const next=[];
    for(let k=0;k<prims.length;k++){
      if(buckets[k].length<1) continue;
      const oldP=prims[k].P;
      const oldRms=rmsOf(M,buckets[k],oldP);
      const cand=robustFit(M,buckets[k],oldP.type,tol);
      // never accept a refit that fits worse — that is how a good fit drifts away
      const P=(cand&&cand.rms<=oldRms)?cand:Object.assign({},oldP,{rms:oldRms});
      next.push({P,faces:buckets[k],area:areaOf(M,buckets[k])});
    }
    prims=next;
  }
  // one primitive per connected patch, so two identical holes stay separate
  const out=[];
  for(const pr of prims){
    for(const comp of splitByConnectivity(M,pr.faces)){
      if(comp.length<1||areaOf(M,comp)<M.area*3e-4) continue;
      const oldRms=rmsOf(M,comp,pr.P);
      const cand=robustFit(M,comp,pr.P.type,tol);
      const P=(cand&&cand.rms<=oldRms)?cand:Object.assign({},pr.P,{rms:oldRms});
      if(P.rms>tol) continue;
      out.push({P,faces:comp,area:areaOf(M,comp)});
    }
  }
  return out;
}
/* ============================================================
   Features: turn fitted primitives into things you can dimension
   ============================================================ */
function axialSpan(M,faces,axis,origin){
  let lo=Infinity,hi=-Infinity;
  const seen=new Set();
  for(const f of faces) for(let c=0;c<3;c++){
    const i=M.face[f*3+c]; if(seen.has(i)) continue; seen.add(i);
    const t=(M.V[i*3]-origin[0])*axis[0]+(M.V[i*3+1]-origin[1])*axis[1]+(M.V[i*3+2]-origin[2])*axis[2];
    if(t<lo)lo=t; if(t>hi)hi=t;
  }
  return [lo,hi];
}
function facesFaceAway(M,faces,centreFn){
  let out=0,inn=0;
  for(const f of faces){
    const c=[M.fc[f*3],M.fc[f*3+1],M.fc[f*3+2]];
    const v=centreFn(c);
    const d=v[0]*M.fn[f*3]+v[1]*M.fn[f*3+1]+v[2]*M.fn[f*3+2];
    if(d>0) out+=M.fa[f]; else inn+=M.fa[f];
  }
  return out>=inn;
}

function expandPlane(M,P,seed,tol,skip){
  const cosT=Math.cos(10*Math.PI/180);
  const seen=new Set(seed), out=[...seed], st=[...seed];
  while(st.length){
    const f=st.pop();
    for(const e of M.faceEdges[f]){
      const E=M.edges[e], g=E.f1===f?E.f2:E.f1;
      if(g<0||seen.has(g)||(skip&&skip[g])) continue;
      if(Math.abs(M.fn[g*3]*P.n[0]+M.fn[g*3+1]*P.n[1]+M.fn[g*3+2]*P.n[2])<cosT) continue;
      let ok=true;
      for(let c=0;c<3&&ok;c++){
        const i=M.face[g*3+c];
        if(Math.abs(M.V[i*3]*P.n[0]+M.V[i*3+1]*P.n[1]+M.V[i*3+2]*P.n[2]-P.d)>tol) ok=false;
      }
      if(!ok) continue;
      seen.add(g); out.push(g); st.push(g);
    }
  }
  return out;
}
/* A facet of a coarsely tessellated cylinder is flat too. Tell them apart by the
   boundary: a real flat face is bounded by sharp edges, a facet by smooth ones. */
function isFacetOfCurve(M,reg){
  const inSet=new Set(reg);
  let smooth=0,total=0;
  for(const f of reg) for(const e of M.faceEdges[f]){
    const E=M.edges[e], g=E.f1===f?E.f2:E.f1;
    if(g<0||inSet.has(g)) continue;
    const A=E.a,B=E.b;
    const L=Math.hypot(M.V[A*3]-M.V[B*3],M.V[A*3+1]-M.V[B*3+1],M.V[A*3+2]-M.V[B*3+2]);
    const d=M.fn[f*3]*M.fn[g*3]+M.fn[f*3+1]*M.fn[g*3+1]+M.fn[f*3+2]*M.fn[g*3+2];
    const ang=Math.acos(Math.max(-1,Math.min(1,d)))*180/Math.PI;
    total+=L; if(ang>1&&ang<25) smooth+=L;
  }
  return total>0&&smooth/total>0.55;
}
function findPlanarRegions(M){
  const tolD=M.diag*3e-4, vis=new Uint8Array(M.nf), out=[];
  const order=[...Array(M.nf).keys()].sort((a,b)=>M.fa[b]-M.fa[a]);
  for(const s of order){
    if(vis[s]) continue;
    const n=[M.fn[s*3],M.fn[s*3+1],M.fn[s*3+2]];
    if(!(Math.abs(n[0])+Math.abs(n[1])+Math.abs(n[2])>0.5)){ vis[s]=1; continue; }
    const P={type:"plane",n,d:n[0]*M.fc[s*3]+n[1]*M.fc[s*3+1]+n[2]*M.fc[s*3+2]};
    const reg=expandPlane(M,P,[s],tolD,vis);
    for(const g of reg) vis[g]=1;
    if(reg.length<1) continue;
    const area=areaOf(M,reg);
    if(area<M.area*0.004) continue;
    if(isFacetOfCurve(M,reg)) continue;
    const fit=fitPlaneP(M,reg); if(!fit) continue;
    out.push({...fit,area,faces:reg});
  }
  return out;
}
function buildFeatures(M,prims){
  const feats=[], planes=findPlanarRegions(M);
  const modelSpan=(a)=>{
    let lo=Infinity,hi=-Infinity;
    for(let i=0;i<M.V.length;i+=3){
      const t=M.V[i]*a[0]+M.V[i+1]*a[1]+M.V[i+2]*a[2];
      if(t<lo)lo=t; if(t>hi)hi=t;
    }
    return [lo,hi];
  };

  for(const pr of prims){
    const P=pr.P;
    if(P.type==="plane") continue;

    if(P.type==="cylinder"){
      const [t0,t1]=axialSpan(M,pr.faces,P.axis,[0,0,0]);
      const hole=!facesFaceAway(M,pr.faces,c=>{
        const v=[c[0]-P.base[0],c[1]-P.base[1],c[2]-P.base[2]];
        const t=v[0]*P.axis[0]+v[1]*P.axis[1]+v[2]*P.axis[2];
        return [v[0]-t*P.axis[0],v[1]-t*P.axis[1],v[2]-t*P.axis[2]];
      });
      feats.push({kind:"cyl",axis:P.axis,base:P.base,radius:P.r,tmin:t0,tmax:t1,
                  hole,area:pr.area,faces:pr.faces,rms:P.rms});
      continue;
    }
    if(P.type==="sphere"){
      const conv=facesFaceAway(M,pr.faces,c=>[c[0]-P.c[0],c[1]-P.c[1],c[2]-P.c[2]]);
      feats.push({kind:"sph",c:P.c,radius:P.r,hole:!conv,area:pr.area,faces:pr.faces,rms:P.rms});
      continue;
    }
    if(P.type==="cone"){
      const [t0,t1]=axialSpan(M,pr.faces,P.axis,P.apex);
      const conv=facesFaceAway(M,pr.faces,c=>{
        const v=[c[0]-P.apex[0],c[1]-P.apex[1],c[2]-P.apex[2]];
        const t=v[0]*P.axis[0]+v[1]*P.axis[1]+v[2]*P.axis[2];
        return [v[0]-t*P.axis[0],v[1]-t*P.axis[1],v[2]-t*P.axis[2]];
      });
      feats.push({kind:"cone",axis:P.axis,apex:P.apex,half:P.half,tmin:t0,tmax:t1,
                  hole:!conv,area:pr.area,faces:pr.faces,rms:P.rms});
      continue;
    }
  }

  // --- merge co-axial cylinders of equal radius (a slot can split one bore in two)
  const cyls=feats.filter(f=>f.kind==="cyl"), rest=feats.filter(f=>f.kind!=="cyl");
  const merged=[];
  for(const c of cyls){
    let hit=null;
    for(const o of merged){
      if(o.hole!==c.hole) continue;
      const d=Math.abs(o.axis[0]*c.axis[0]+o.axis[1]*c.axis[1]+o.axis[2]*c.axis[2]);
      if(d<0.999) continue;
      if(Math.abs(o.radius-c.radius)>Math.max(o.radius*0.01,M.diag*3e-4)) continue;
      const dv=[c.base[0]-o.base[0],c.base[1]-o.base[1],c.base[2]-o.base[2]];
      const t=dv[0]*o.axis[0]+dv[1]*o.axis[1]+dv[2]*o.axis[2];
      if(Math.hypot(dv[0]-t*o.axis[0],dv[1]-t*o.axis[1],dv[2]-t*o.axis[2])>Math.max(o.radius*0.01,M.diag*3e-4)) continue;
      hit=o; break;
    }
    if(hit){
      const flip=(hit.axis[0]*c.axis[0]+hit.axis[1]*c.axis[1]+hit.axis[2]*c.axis[2])<0;
      hit.tmin=Math.min(hit.tmin, flip?-c.tmax:c.tmin);
      hit.tmax=Math.max(hit.tmax, flip?-c.tmin:c.tmax);
      hit.area+=c.area; hit.faces=hit.faces.concat(c.faces);
    } else merged.push({...c});
  }

  // --- merge concentric spheres of equal radius
  const sph=rest.filter(f=>f.kind==="sph"), rest2=rest.filter(f=>f.kind!=="sph");
  const sm=[];
  for(const s of sph){
    let hit=null;
    for(const o of sm){
      if(o.hole!==s.hole) continue;
      if(Math.abs(o.radius-s.radius)>Math.max(o.radius*0.01,M.diag*3e-4)) continue;
      if(Math.hypot(o.c[0]-s.c[0],o.c[1]-s.c[1],o.c[2]-s.c[2])>Math.max(o.radius*0.01,M.diag*3e-4)) continue;
      hit=o; break;
    }
    if(hit){ hit.area+=s.area; hit.faces=hit.faces.concat(s.faces); }
    else sm.push({...s});
  }

  const all=[...merged,...sm,...rest2].filter(f=>f.area>M.area*0.004);

  // --- geometry each feature needs for drawing
  for(const f of all){
    if(f.kind==="cyl"||f.kind==="cone"){
      const org=f.kind==="cone"?f.apex:[0,0,0];
      f.p0=[org[0]+f.axis[0]*f.tmin,org[1]+f.axis[1]*f.tmin,org[2]+f.axis[2]*f.tmin];
      f.p1=[org[0]+f.axis[0]*f.tmax,org[1]+f.axis[1]*f.tmax,org[2]+f.axis[2]*f.tmax];
      if(f.kind==="cyl"){
        f.p0=[f.base[0]+f.axis[0]*f.tmin,f.base[1]+f.axis[1]*f.tmin,f.base[2]+f.axis[2]*f.tmin];
        f.p1=[f.base[0]+f.axis[0]*f.tmax,f.base[1]+f.axis[1]*f.tmax,f.base[2]+f.axis[2]*f.tmax];
      }
      f.mid=[(f.p0[0]+f.p1[0])/2,(f.p0[1]+f.p1[1])/2,(f.p0[2]+f.p1[2])/2];
      f.len=f.tmax-f.tmin;
      if(f.kind==="cone"){ f.r0=Math.abs(f.tmin)*Math.tan(f.half); f.r1=Math.abs(f.tmax)*Math.tan(f.half); }
    } else {
      f.mid=f.c.slice(); f.len=2*f.radius;
    }
  }

  // --- the part's dominant axis: the one most cylinders share
  let up=[0,0,1], bestW=0;
  const axes=[[1,0,0],[0,1,0],[0,0,1]];
  for(let i=0;i<3;i++){
    let w=0;
    for(const f of all) if(f.kind==="cyl"||f.kind==="cone")
      if(Math.abs(f.axis[0]*axes[i][0]+f.axis[1]*axes[i][1]+f.axis[2]*axes[i][2])>0.98) w+=f.area;
    if(w>bestW){ bestW=w; up=axes[i]; }
  }
  if(bestW<=0){                       // no round features: fall back to the tallest direction
    let best=0;
    for(let i=0;i<3;i++){ const s2=M.mx[i]-M.mn[i]; if(s2>best){ best=s2; up=axes[i]; } }
  }

  // --- through-hole test
  for(const f of all){
    if(f.kind!=="cyl"||!f.hole){ f.through=false; continue; }
    const [lo,hi]=modelSpan(f.axis);
    const eps=(hi-lo)*0.02;
    f.through=(f.tmin<=lo+eps)&&(f.tmax>=hi-eps);
  }

  // --- angles: planes that are neither parallel nor square to the part axis
  const angles=[];
  for(const p of planes){
    if(p.area<M.area*0.008) continue;
    const c=Math.abs(p.n[0]*up[0]+p.n[1]*up[1]+p.n[2]*up[2]);
    const fromBase=Math.acos(Math.max(-1,Math.min(1,c)))*180/Math.PI;   // plane vs the base plane
    if(fromBase<2||fromBase>88) continue;                                // square or flat: not an angle
    let cen=[0,0,0],A=0;
    for(const f of p.faces){ const w=M.fa[f]; A+=w; for(let i=0;i<3;i++) cen[i]+=w*M.fc[f*3+i]; }
    cen=cen.map(v=>v/A);
    angles.push({n:p.n,d:p.d,area:p.area,centroid:cen,deg:fromBase,faces:p.faces});
  }
  angles.sort((a,b)=>b.area-a.area);
  const groups=[];
  for(const a of angles){
    let hit=null;
    for(const g of groups){
      if(Math.abs(g.deg-a.deg)>1) continue;
      const d=Math.abs(g.n[0]*a.n[0]+g.n[1]*a.n[1]+g.n[2]*a.n[2]);
      if(d<0.985) continue;
      hit=g; break;
    }
    if(hit){ hit.area+=a.area; hit.faces=hit.faces.concat(a.faces); hit.parts++; }
    else groups.push({...a,parts:1,faces:a.faces.slice()});
  }
  groups.sort((a,b)=>b.area-a.area);

  all.sort((a,b)=>(a.hole===b.hole)?b.radius-a.radius:(a.hole?-1:1));
  return {feats:all,planes,angles:groups,up};
}

/* ============================================================
   Step levels along each axis
   ============================================================ */
function sharpLoops(M){
  const cos25=Math.cos(25*Math.PI/180);
  const sharp=[];
  for(let e=0;e<M.edges.length;e++){
    const E=M.edges[e];
    if(E.f2<0){ sharp.push(e); continue; }
    const d=M.fn[E.f1*3]*M.fn[E.f2*3]+M.fn[E.f1*3+1]*M.fn[E.f2*3+1]+M.fn[E.f1*3+2]*M.fn[E.f2*3+2];
    if(d<cos25) sharp.push(e);
  }
  const byVert=new Map();
  for(const e of sharp) for(const v of [M.edges[e].a,M.edges[e].b]){
    if(!byVert.has(v)) byVert.set(v,[]); byVert.get(v).push(e);
  }
  const seen=new Set(), loops=[];
  for(const e0 of sharp){
    if(seen.has(e0)) continue;
    const comp=[], st=[e0]; seen.add(e0);
    while(st.length){
      const e=st.pop(); comp.push(e);
      for(const v of [M.edges[e].a,M.edges[e].b])
        for(const g of byVert.get(v)||[]) if(!seen.has(g)){ seen.add(g); st.push(g); }
    }
    let L=0, vs=new Set();
    for(const e of comp){
      const A=M.edges[e].a, B=M.edges[e].b; vs.add(A); vs.add(B);
      L+=Math.hypot(M.V[A*3]-M.V[B*3],M.V[A*3+1]-M.V[B*3+1],M.V[A*3+2]-M.V[B*3+2]);
    }
    loops.push({edges:comp,verts:[...vs],length:L});
  }
  return loops;
}
/* Sharp creases that run around an axis (e.g. where a cylinder meets a taper) mark a
   real height break even when neither side got fitted as a clean primitive - a fitted
   cylinder/cone/plane is a bonus, not a requirement, for that boundary to be worth a
   dimension. Group them into ridge "circles" by level so a whole ring counts once. */
function axisRidges(M,e,tol){
  const levels=[];
  for(let i=0;i<M.edges.length;i++){
    const E=M.edges[i];
    if(E.f2<0) continue;
    const d=M.fn[E.f1*3]*M.fn[E.f2*3]+M.fn[E.f1*3+1]*M.fn[E.f2*3+1]+M.fn[E.f1*3+2]*M.fn[E.f2*3+2];
    if(d>0.94) continue;                          // shallow - not a real crease
    const ax=M.V[E.a*3],ay=M.V[E.a*3+1],az=M.V[E.a*3+2];
    const bx=M.V[E.b*3],by=M.V[E.b*3+1],bz=M.V[E.b*3+2];
    let ex=bx-ax,ey=by-ay,ez=bz-az;
    const L=Math.hypot(ex,ey,ez); if(!(L>0)) continue;
    ex/=L; ey/=L; ez/=L;
    if(Math.abs(ex*e[0]+ey*e[1]+ez*e[2])>0.2) continue;   // runs along the axis, not around it
    const t=((ax+bx)/2)*e[0]+((ay+by)/2)*e[1]+((az+bz)/2)*e[2];
    let hit=null;
    for(const lv of levels) if(Math.abs(lv.t-t)<=tol){ hit=lv; break; }
    if(hit){ hit.t=(hit.t*hit.len+t*L)/(hit.len+L); hit.len+=L; }
    else levels.push({t,len:L});
  }
  // a full ring's summed edge length is its circumference - square it so a prominent
  // ridge competes fairly against the fitted faces/features measured in area (~length^2)
  return levels.map(lv=>({t:lv.t,w:lv.len*lv.len}));
}
function findSteps(M,planes,feats,angles,up){
  const AX=[[1,0,0],[0,1,0],[0,0,1]];
  const out=[];
  for(let ai=0;ai<3;ai++){
    const e=AX[ai];
    const span=M.mx[ai]-M.mn[ai];
    if(span<=0) continue;
    // levels closer together than this would be unreadable on a drawing
    const tol=Math.max(M.diag*3e-4,span*0.008);
    const cand=[];
    // flat faces square to this axis
    for(const p of planes){
      if(p.area<M.area*0.0015) continue;
      const dp=p.n[0]*e[0]+p.n[1]*e[1]+p.n[2]*e[2];
      if(Math.abs(dp)<0.985) continue;
      cand.push({t:dp>0?p.d:-p.d,w:p.area});
    }
    // a feature only marks levels along its OWN axis, never sideways
    const alignedUp=Math.abs(up[0]*e[0]+up[1]*e[1]+up[2]*e[2])>0.98;
    const bits=[];
    for(const f of feats){
      if(f.area<M.area*0.025) continue;
      if(f.kind==="cyl"||f.kind==="cone"){
        if(Math.abs(f.axis[0]*e[0]+f.axis[1]*e[1]+f.axis[2]*e[2])>0.98) bits.push({faces:f.faces,w:f.area});
      } else if(f.kind==="sph"&&alignedUp) bits.push({faces:f.faces,w:f.area});
    }
    if(alignedUp) for(const a of angles) if(a.area>=M.area*0.02) bits.push({faces:a.faces,w:a.area});
    for(const b of bits){
      const [lo,hi]=axialSpan(M,b.faces,e,[0,0,0]);
      cand.push({t:lo,w:b.w}); cand.push({t:hi,w:b.w});
    }
    // creases the fitter never confidently claimed (an ambiguous taper, say) still
    // mark a real height boundary - only worth the extra clutter on the axis a
    // body-of-revolution part is actually built around
    if(alignedUp) for(const rg of axisRidges(M,e,tol)) cand.push(rg);

    if(!cand.length) continue;
    cand.sort((a,b)=>a.t-b.t);
    const lo=M.mn[ai], hi=M.mx[ai];
    const merged=[];
    for(const c of cand){
      const last=merged[merged.length-1];
      if(last&&Math.abs(c.t-last.t)<=tol) last.w=Math.max(last.w,c.w);
      else merged.push({t:c.t,w:c.w});
    }
    let inner=merged.filter(m=>m.t>lo+tol&&m.t<hi-tol);
    if(!inner.length) continue;
    inner.sort((a,b)=>b.w-a.w);
    inner=inner.slice(0,alignedUp?6:4).sort((a,b)=>a.t-b.t);
    const ts=[lo,...inner.map(m=>m.t),hi];
    const uniq=[]; for(const t of ts) if(!uniq.length||t-uniq[uniq.length-1]>tol) uniq.push(t);
    if(uniq.length<3) continue;
    const segs=[];
    for(let i=1;i<uniq.length;i++) segs.push({a:uniq[i-1],b:uniq[i],len:uniq[i]-uniq[i-1]});
    out.push({axis:"XYZ"[ai],ai,levels:uniq,segs});
  }
  return out;
}

/* ============================================================
   Section: raw plane/mesh intersection segments
   ============================================================ */
function sliceSegments(M,N,D){
  const segs=[];
  for(let f=0;f<M.nf;f++){
    const I=[M.face[f*3],M.face[f*3+1],M.face[f*3+2]];
    const p=I.map(i=>[M.V[i*3],M.V[i*3+1],M.V[i*3+2]]);
    const s=p.map(q=>q[0]*N[0]+q[1]*N[1]+q[2]*N[2]-D);
    const hit=[];
    for(let e=0;e<3;e++){
      const a=s[e],b=s[(e+1)%3],pa=p[e],pb=p[(e+1)%3];
      if((a<0&&b>=0)||(a>=0&&b<0)){
        const t=a/(a-b);
        hit.push([pa[0]+t*(pb[0]-pa[0]),pa[1]+t*(pb[1]-pa[1]),pa[2]+t*(pb[2]-pa[2])]);
      }
    }
    if(hit.length===2) segs.push(hit);
  }
  return segs;
}

function analyse(M){
  const prims=extractPrimitives(M,segment);
  const bf=buildFeatures(M,prims);
  const steps=findSteps(M,bf.planes,bf.feats,bf.angles,bf.up);
  // both cut planes up front: the section follows whichever elevation is on show
  const secY=sliceSegments(M,[0,1,0],(M.mn[1]+M.mx[1])/2);
  const secX=sliceSegments(M,[1,0,0],(M.mn[0]+M.mx[0])/2);
  return {feats:bf.feats,planes:bf.planes,angles:bf.angles,up:bf.up,steps,secY,secX};
}
/* ============================================================
   Views
   ============================================================ */
function mkView(name,f,up,ax){
  const n=v=>{const L=Math.hypot(...v);return v.map(x=>x/L);};
  f=n(f); up=n(up);
  const r=n([f[1]*up[2]-f[2]*up[1], f[2]*up[0]-f[0]*up[2], f[0]*up[1]-f[1]*up[0]]);
  const u=[r[1]*f[2]-r[2]*f[1], r[2]*f[0]-r[0]*f[2], r[0]*f[1]-r[1]*f[0]];
  return {name,f,r,u:[-u[0],-u[1],-u[2]],ax};
}
const V_TOP   =mkView("TOP",   [0,0,-1],[0,1,0], "X \u2192  Y \u2191");
const V_BOTTOM=mkView("BOTTOM",[0,0,1], [0,-1,0],"X \u2192  Y \u2193");
const ISO_HOME={az:Math.PI/4, el:Math.atan2(0.85,Math.SQRT2)};
const ISO={az:ISO_HOME.az, el:ISO_HOME.el};
function isoView(az,el){
  el=Math.max(-1.45,Math.min(1.45,el));
  const d=[Math.cos(el)*Math.cos(az),Math.cos(el)*Math.sin(az),Math.sin(el)];
  return mkView("ISO",[-d[0],-d[1],-d[2]],[0,0,1],"");
}
const V_FRONT =mkView("FRONT", [0,1,0], [0,0,1], "X \u2192  Z \u2191");
const V_RIGHT =mkView("RIGHT", [-1,0,0],[0,0,1], "Y \u2192  Z \u2191");
const V_SEC   =mkView("SECTION A-A",[0,1,0],[0,0,1],"X \u2192  Z \u2191");
const V_SEC_R =mkView("SECTION A-A",[-1,0,0],[0,0,1],"Y \u2192  Z \u2191");

/* ============================================================
   Sheet
   ============================================================ */
const SHEET="#13284B", PENCIL="#EAF1FB", BLUE="#8FC1FF", CENTRE="#5C7CA6", RED="#FF4F70";
const HATCH="#5E7FA8";
const GRID="#4A6C96", DIM_TEXT="#9FB8D9", HINT_TEXT="#7E97BE", HIDDEN="#4A6688";
const MONO='11px ui-monospace,"SF Mono",Menlo,Consolas,monospace';
const SHEETINFO={pane:null,scale:1,ctr:[0,0,0],gridX:0,gridY:0,single:false};
let SINGLE_VIEW=null; // null = full 4-up sheet; 0..3 = one pane shown full-size (mobile)

function sheetLayout(cssW,M,S){
  const cssH=Math.round(cssW*0.82);
  const PAD=13, TB=78;
  const area={x:PAD+12,y:PAD+12,w:cssW-2*PAD-24,h:cssH-2*PAD-24-TB};
  const pw=area.w/2, ph=area.h/2;
  const panes=[{x:area.x,y:area.y,w:pw,h:ph},{x:area.x+pw,y:area.y,w:pw,h:ph},
               {x:area.x,y:area.y+ph,w:pw,h:ph},{x:area.x+pw,y:area.y+ph,w:pw,h:ph}];
  const plan=S.top==="bottom"?V_BOTTOM:V_TOP;
  const elev=S.elev==="right"?V_RIGHT:V_FRONT;
  const other=S.elev==="right"?V_FRONT:V_RIGHT;
  const sec=S.elev==="right"?V_SEC_R:V_SEC;
  const views=[plan,isoView(ISO.az,ISO.el),elev,S.fourth==="section"?sec:other];
  const standard=(S.top!=="bottom"&&S.elev!=="right");
  const ctr=[(M.mn[0]+M.mx[0])/2,(M.mn[1]+M.mx[1])/2,(M.mn[2]+M.mx[2])/2];
  const corners=[];
  for(let i=0;i<8;i++) corners.push([(i&1?M.mx[0]:M.mn[0])-ctr[0],(i&2?M.mx[1]:M.mn[1])-ctr[1],(i&4?M.mx[2]:M.mn[2])-ctr[2]]);
  let scale=Infinity;
  for(const V of views){
    let w=0,h=0;
    for(const c of corners){
      w=Math.max(w,Math.abs(c[0]*V.r[0]+c[1]*V.r[1]+c[2]*V.r[2])*2);
      h=Math.max(h,Math.abs(c[0]*V.u[0]+c[1]*V.u[1]+c[2]*V.u[2])*2);
    }
    scale=Math.min(scale,(pw-132)/Math.max(w,1e-6),(ph-124)/Math.max(h,1e-6));
  }
  return {cssW,cssH,PAD,TB,area,panes,views,ctr,scale,standard,
          gridX:Math.round(area.x+area.w/2)+.5, gridY:Math.round(area.y+area.h/2)+.5,
          title:{x:area.x,y:area.y+area.h+6,w:area.w,h:TB-6}};
}

function paintSheet(g,L,M,A,S){
  g.__mark&&g.__mark("frame");
  g.fillStyle=SHEET; g.fillRect(0,0,L.cssW,L.cssH);
  g.strokeStyle=PENCIL; g.lineWidth=1.4;
  g.strokeRect(L.PAD+.5,L.PAD+.5,L.cssW-2*L.PAD-1,L.cssH-2*L.PAD-1);
  g.lineWidth=.6; g.strokeStyle=GRID;
  g.strokeRect(L.PAD+5.5,L.PAD+5.5,L.cssW-2*L.PAD-11,L.cssH-2*L.PAD-11);
  for(let i=0;i<4;i++) drawView(g,L.panes[i],L.views[i],M,A,L.scale,L.ctr,S,false,i!==1);
  // a light cross separating the four panes, like a printed sheet's fold/grid lines
  g.__mark&&g.__mark("grid");
  g.strokeStyle=GRID; g.lineWidth=.6;
  g.beginPath();
  g.moveTo(L.gridX,L.area.y); g.lineTo(L.gridX,L.area.y+L.area.h);
  g.moveTo(L.area.x,L.gridY); g.lineTo(L.area.x+L.area.w,L.gridY);
  g.stroke();
  g.__mark&&g.__mark("title");
  drawTitleBlock(g,L.title,M,S,L.scale,L.standard);
}

function drawSheet(cv,M,A,S){
  const cssW=cv.clientWidth||960;
  const L=sheetLayout(cssW,M,S);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  cv.width=L.cssW*dpr; cv.height=L.cssH*dpr; cv.style.height=L.cssH+"px";
  const g=cv.getContext("2d");
  g.setTransform(dpr,0,0,dpr,0,0);
  SHEETINFO.pane=L.panes[1]; SHEETINFO.scale=L.scale; SHEETINFO.ctr=L.ctr;
  SHEETINFO.gridX=L.gridX; SHEETINFO.gridY=L.gridY; SHEETINFO.single=false;
  if(!S.forExport) DIMHIT.length=0;
  paintSheet(g,L,M,A,S);
  positionPaneSelects(L);
}

// keeps the per-view <select> overlays glued to their pane's top-left corner
function positionPaneSelects(L){
  const put=(id,pane)=>{
    const el=document.getElementById(id);
    if(!el||!pane) return;
    el.style.display="";
    el.style.left=(pane.x+1)+"px";
    el.style.top=(pane.y-3)+"px";
  };
  put("topSel",L.panes[0]);
  put("elevSel",L.panes[2]);
  put("fourthSel",L.panes[3]);
}

/* Single-pane layout: one view fills the whole sheet instead of a quartered
   grid, used on narrow screens where four panes at once are unreadable. */
function sheetLayoutSingle(cssW,M,S,idx){
  const cssH=Math.round(cssW*1.3);
  const PAD=13, TB=78;
  const area={x:PAD+12,y:PAD+12,w:cssW-2*PAD-24,h:cssH-2*PAD-24-TB};
  const pane={x:area.x,y:area.y,w:area.w,h:area.h};
  const plan=S.top==="bottom"?V_BOTTOM:V_TOP;
  const elev=S.elev==="right"?V_RIGHT:V_FRONT;
  const other=S.elev==="right"?V_FRONT:V_RIGHT;
  const sec=S.elev==="right"?V_SEC_R:V_SEC;
  const views=[plan,isoView(ISO.az,ISO.el),elev,S.fourth==="section"?sec:other];
  const standard=(S.top!=="bottom"&&S.elev!=="right");
  const ctr=[(M.mn[0]+M.mx[0])/2,(M.mn[1]+M.mx[1])/2,(M.mn[2]+M.mx[2])/2];
  const corners=[];
  for(let i=0;i<8;i++) corners.push([(i&1?M.mx[0]:M.mn[0])-ctr[0],(i&2?M.mx[1]:M.mn[1])-ctr[1],(i&4?M.mx[2]:M.mn[2])-ctr[2]]);
  const V=views[idx];
  let w=0,h=0;
  for(const c of corners){
    w=Math.max(w,Math.abs(c[0]*V.r[0]+c[1]*V.r[1]+c[2]*V.r[2])*2);
    h=Math.max(h,Math.abs(c[0]*V.u[0]+c[1]*V.u[1]+c[2]*V.u[2])*2);
  }
  const scale=Math.min((pane.w-132)/Math.max(w,1e-6),(pane.h-124)/Math.max(h,1e-6));
  return {cssW,cssH,PAD,TB,area,panes:[pane],views,idx,ctr,scale,standard,
          title:{x:area.x,y:area.y+area.h+6,w:area.w,h:TB-6}};
}

function paintSheetSingle(g,L,M,A,S){
  g.fillStyle=SHEET; g.fillRect(0,0,L.cssW,L.cssH);
  g.strokeStyle=PENCIL; g.lineWidth=1.4;
  g.strokeRect(L.PAD+.5,L.PAD+.5,L.cssW-2*L.PAD-1,L.cssH-2*L.PAD-1);
  g.lineWidth=.6; g.strokeStyle=GRID;
  g.strokeRect(L.PAD+5.5,L.PAD+5.5,L.cssW-2*L.PAD-11,L.cssH-2*L.PAD-11);
  drawView(g,L.panes[0],L.views[L.idx],M,A,L.scale,L.ctr,S,false,L.idx!==1);
  drawTitleBlock(g,L.title,M,S,L.scale,L.standard);
}

function drawSheetSingle(cv,M,A,S,idx){
  const cssW=cv.clientWidth||960;
  const L=sheetLayoutSingle(cssW,M,S,idx);
  const dpr=Math.min(window.devicePixelRatio||1,2);
  cv.width=L.cssW*dpr; cv.height=L.cssH*dpr; cv.style.height=L.cssH+"px";
  const g=cv.getContext("2d");
  g.setTransform(dpr,0,0,dpr,0,0);
  if(idx===1){ SHEETINFO.pane=L.panes[0]; SHEETINFO.scale=L.scale; SHEETINFO.ctr=L.ctr; }
  else SHEETINFO.pane=null;
  SHEETINFO.single=true;
  if(!S.forExport) DIMHIT.length=0;
  paintSheetSingle(g,L,M,A,S);
  positionPaneSelectsSingle(L,idx);
}

// in single-view mode only the select matching the visible pane is shown
function positionPaneSelectsSingle(L,idx){
  const slots=[["topSel",0],["elevSel",2],["fourthSel",3]];
  slots.forEach(([id,i])=>{
    const el=document.getElementById(id);
    if(!el) return;
    if(i===idx){
      el.style.display="";
      el.style.left=(L.panes[0].x+1)+"px";
      el.style.top=(L.panes[0].y-3)+"px";
    } else {
      el.style.display="none";
    }
  });
}

function drawView(g,P,V,M,A,scale,ctr,S,quick,hasSelect){
  const cx=P.x+P.w/2, cy=P.y+P.h/2;
  const proj=p=>[
    cx+((p[0]-ctr[0])*V.r[0]+(p[1]-ctr[1])*V.r[1]+(p[2]-ctr[2])*V.r[2])*scale,
    cy+((p[0]-ctr[0])*V.u[0]+(p[1]-ctr[1])*V.u[1]+(p[2]-ctr[2])*V.u[2])*scale ];

  const nV=M.V.length/3, sx=new Float64Array(nV), sy=new Float64Array(nV);
  for(let i=0;i<nV;i++){
    const x=M.V[i*3]-ctr[0], y=M.V[i*3+1]-ctr[1], z=M.V[i*3+2]-ctr[2];
    sx[i]=cx+(x*V.r[0]+y*V.r[1]+z*V.r[2])*scale;
    sy[i]=cy+(x*V.u[0]+y*V.u[1]+z*V.u[2])*scale;
  }
  const isSec=V.name.indexOf("SECTION")===0;
  const cutN=V.f, cutD=ctr[0]*V.f[0]+ctr[1]*V.f[1]+ctr[2]*V.f[2];
  const eps=M.diag*1e-6;
  const keep=new Uint8Array(M.nf).fill(1);
  if(isSec){
    for(let f=0;f<M.nf;f++){
      let ok=1;
      for(let c=0;c<3;c++){
        const i=M.face[f*3+c];
        if(M.V[i*3]*cutN[0]+M.V[i*3+1]*cutN[1]+M.V[i*3+2]*cutN[2]-cutD < -eps){ ok=0; break; }
      }
      keep[f]=ok;
    }
  }

  const dep=new Float64Array(M.nf), front=new Uint8Array(M.nf);
  for(let f=0;f<M.nf;f++){
    dep[f]=M.fc[f*3]*V.f[0]+M.fc[f*3+1]*V.f[1]+M.fc[f*3+2]*V.f[2];
    front[f]=(M.fn[f*3]*V.f[0]+M.fn[f*3+1]*V.f[1]+M.fn[f*3+2]*V.f[2])<0?1:0;
  }
  const owner=new Map();
  if(!quick) for(let e=0;e<M.edges.length;e++){
    const E=M.edges[e];
    if(!keep[E.f1]&&(E.f2<0||!keep[E.f2])) continue;
    let show=false;
    if(E.f2<0) show=true;
    else if(!keep[E.f1]||!keep[E.f2]) show=false;
    else if(front[E.f1]!==front[E.f2]) show=true;
    else{
      // a real crease shows up regardless of which fitted patch either face landed in -
      // relying on patchOf alone missed boundaries where noisy CSG output put both
      // faces in the same patch despite a sharp dihedral angle between them
      const d=M.fn[E.f1*3]*M.fn[E.f2*3]+M.fn[E.f1*3+1]*M.fn[E.f2*3+1]+M.fn[E.f1*3+2]*M.fn[E.f2*3+2];
      if(d<0.9063) show=true;
    }
    if(!show) continue;
    let host=E.f1;
    if(E.f2>=0&&keep[E.f2]){
      if(front[E.f1]&&!front[E.f2]) host=E.f1;
      else if(front[E.f2]&&!front[E.f1]) host=E.f2;
      else host=dep[E.f1]<dep[E.f2]?E.f1:E.f2;
    }
    if(!keep[host]) continue;
    let arr=owner.get(host); if(!arr){arr=[];owner.set(host,arr);} arr.push(e);
  }

  const order=[];
  for(let f=0;f<M.nf;f++) if(keep[f]&&(front[f]||owner.has(f))) order.push(f);
  order.sort((a,b)=>dep[b]-dep[a]);

  const iso=V.name==="ISO";
  g.__mark&&g.__mark("mesh",V,P);
  g.save();
  g.beginPath(); g.rect(P.x,P.y,P.w,P.h); g.clip();
  g.lineJoin="round"; g.lineCap="round";
  for(const f of order){
    if(front[f]){
      const a=M.face[f*3],b=M.face[f*3+1],c=M.face[f*3+2];
      let fill=SHEET;
      if(iso){
        const l=Math.max(0,M.fn[f*3]*-0.42+M.fn[f*3+1]*-0.55+M.fn[f*3+2]*0.72);
        const r=Math.round(19+l*121), gg=Math.round(40+l*140), b=Math.round(75+l*155);
        fill=`rgb(${r},${gg},${b})`;
      }
      g.fillStyle=fill; g.strokeStyle=fill; g.lineWidth=.8;
      g.beginPath(); g.moveTo(sx[a],sy[a]); g.lineTo(sx[b],sy[b]); g.lineTo(sx[c],sy[c]); g.closePath();
      g.fill(); g.stroke();
    }
    const es=owner.get(f);
    if(es){
      g.strokeStyle=PENCIL; g.lineWidth=iso?.85:1.05;
      g.beginPath();
      for(const e of es){ const E=M.edges[e]; g.moveTo(sx[E.a],sy[E.a]); g.lineTo(sx[E.b],sy[E.b]); }
      g.stroke();
    }
  }
  // the cut face itself: solid fill, then hatch, then a heavy outline
  g.__mark&&g.__mark("sec",V,P);
  const secSrc=isSec?(Math.abs(V.f[0])>0.9?A.secX:A.secY):null;
  if(isSec&&secSrc&&secSrc.length){
    const S2=secSrc.map(s=>[proj(s[0]),proj(s[1])]);
    scanFill(g,S2,1.15,45,SHEET,1.3);
    scanFill(g,S2,6.5,45,HATCH,0.65);
    g.strokeStyle=PENCIL; g.lineWidth=1.35;
    g.beginPath();
    for(const [a,b] of S2){ g.moveTo(a[0],a[1]); g.lineTo(b[0],b[1]); }
    g.stroke();
  }
  g.restore();

  g.__mark&&g.__mark("anno",V,P);
  g.save();
  g.beginPath(); g.rect(P.x,P.y,P.w,P.h); g.clip();
  if(!iso&&!quick) annotate(g,P,V,M,A,scale,ctr,proj,S,isSec);
  g.restore();

  g.__mark&&g.__mark("label",V,P);
  g.font='600 10px ui-monospace,"SF Mono",Menlo,Consolas,monospace';
  g.fillStyle=PENCIL; g.textAlign="left"; g.textBaseline="top";
  // on screen, panes with a live view-picker show the name via the <select> overlay instead
  if(!hasSelect||S.forExport){
    g.fillText(V.name,P.x+4,P.y+3);
    if(V.ax){ g.font=MONO; g.fillStyle=DIM_TEXT; g.fillText(V.ax,P.x+4+g.measureText(V.name).width+12,P.y+3.5); }
  } else if(V.ax){
    g.font=MONO; g.fillStyle=DIM_TEXT; g.fillText(V.ax,P.x+4,P.y+19);
  }
  if(iso&&!S.forExport){          // on-screen affordances, not drawing content
    g.font=MONO; g.fillStyle=HINT_TEXT; g.textAlign="left"; g.textBaseline="bottom";
    g.fillText("drag to rotate \u00b7 double-click to reset",P.x+4,P.y+P.h-3);
    g.textBaseline="top";
    const el=Math.round(ISO.el*180/Math.PI), az=Math.round(((ISO.az*180/Math.PI)%360+360)%360);
    g.textAlign="right"; g.fillText(az+"\u00b0 / "+el+"\u00b0",P.x+P.w-4,P.y+3.5); g.textAlign="left";
  }
}

/* even-odd scanline fill over loose segments — no loop chaining needed */
function scanFill(g,segs,spacing,angleDeg,colour,width){
  const a=angleDeg*Math.PI/180, ca=Math.cos(a), sa=Math.sin(a);
  const rs=segs.map(s=>[[s[0][0]*ca+s[0][1]*sa,-s[0][0]*sa+s[0][1]*ca],
                        [s[1][0]*ca+s[1][1]*sa,-s[1][0]*sa+s[1][1]*ca]]);
  let lo=Infinity,hi=-Infinity;
  for(const s of rs) for(const p of s){ if(p[1]<lo)lo=p[1]; if(p[1]>hi)hi=p[1]; }
  if(!isFinite(lo)) return;
  g.save(); g.strokeStyle=colour; g.lineWidth=width; g.lineCap="butt";
  g.beginPath();
  for(let y=Math.ceil(lo/spacing)*spacing;y<=hi;y+=spacing){
    const xs=[];
    for(const [A,B] of rs){
      const y0=A[1],y1=B[1];
      if((y0<=y&&y1>y)||(y1<=y&&y0>y)) xs.push(A[0]+(y-y0)/(y1-y0)*(B[0]-A[0]));
    }
    if(xs.length<2) continue;
    xs.sort((p,q)=>p-q);
    for(let i=0;i+1<xs.length;i+=2){
      g.moveTo(xs[i]*ca-y*sa, xs[i]*sa+y*ca);
      g.lineTo(xs[i+1]*ca-y*sa, xs[i+1]*sa+y*ca);
    }
  }
  g.stroke(); g.restore();
}

/* ---------- dimension primitives ---------- */
function arrow(g,x,y,dx,dy){
  const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
  const px=-dy,py=dx,a=6.5,w=2.1;
  g.beginPath(); g.moveTo(x,y);
  g.lineTo(x-dx*a+px*w,y-dy*a+py*w); g.lineTo(x-dx*a-px*w,y-dy*a-py*w);
  g.closePath(); g.fill();
}
function dimText(g,x,y,txt,col){
  g.font=MONO; g.textAlign="center"; g.textBaseline="middle";
  const w=g.measureText(txt).width;
  g.fillStyle=SHEET; g.fillRect(x-w/2-2.5,y-6,w+5,12);
  g.fillStyle=col||BLUE; g.fillText(txt,x,y+.5);
}
function dimH(g,x1,x2,objY,dimY,txt,on){
  if(x2<x1)[x1,x2]=[x2,x1];
  const col=on?RED:BLUE;
  g.strokeStyle=col; g.fillStyle=col; g.lineWidth=on?1.2:.75;
  const s=Math.sign(dimY-objY)||1;
  g.beginPath();
  g.moveTo(x1,objY+s*2.5); g.lineTo(x1,dimY+s*3.5);
  g.moveTo(x2,objY+s*2.5); g.lineTo(x2,dimY+s*3.5);
  g.moveTo(x1,dimY); g.lineTo(x2,dimY);
  g.stroke();
  arrow(g,x1,dimY,-1,0); arrow(g,x2,dimY,1,0);
  dimText(g,(x1+x2)/2,dimY,txt,col);
}
function dimV(g,y1,y2,objX,dimX,txt,on){
  if(y2<y1)[y1,y2]=[y2,y1];
  const col=on?RED:BLUE;
  g.strokeStyle=col; g.fillStyle=col; g.lineWidth=on?1.2:.75;
  const s=Math.sign(dimX-objX)||1;
  g.beginPath();
  g.moveTo(objX+s*2.5,y1); g.lineTo(dimX+s*3.5,y1);
  g.moveTo(objX+s*2.5,y2); g.lineTo(dimX+s*3.5,y2);
  g.moveTo(dimX,y1); g.lineTo(dimX,y2);
  g.stroke();
  arrow(g,dimX,y1,0,-1); arrow(g,dimX,y2,0,1);
  g.save(); g.translate(dimX,(y1+y2)/2); g.rotate(-Math.PI/2);
  dimText(g,0,0,txt,col); g.restore();
}
function leader(g,ax,ay,ux,uy,dist,txt,on){
  const lx=ax+ux*dist, ly=ay+uy*dist;
  const dir=ux>=0?1:-1, tx=lx+dir*14;
  const col=on?RED:BLUE;
  g.strokeStyle=col; g.fillStyle=col; g.lineWidth=on?1.2:.75;
  g.beginPath(); g.moveTo(ax,ay); g.lineTo(lx,ly); g.lineTo(tx,ly); g.stroke();
  arrow(g,ax,ay,ax-lx,ay-ly);
  g.font=MONO; g.textBaseline="middle"; g.textAlign=dir>0?"left":"right";
  const w=g.measureText(txt).width;
  g.fillStyle=SHEET; g.fillRect(dir>0?tx+1:tx-w-3,ly-6.5,w+3,13);
  g.fillStyle=col; g.fillText(txt,tx+dir*2.5,ly);
}
function dimAngle(g,x,y,dx,dy,txt,on){
  const col=on?RED:BLUE, R=25;
  const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
  let a1=Math.atan2(dy,dx);
  const a0=Math.cos(a1)>=0?0:Math.PI;
  let d=a1-a0; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI;
  a1=a0+d;
  g.strokeStyle=col; g.fillStyle=col; g.lineWidth=on?1.1:.7;
  g.save(); g.setLineDash([5,3]);
  g.beginPath();
  g.moveTo(x,y); g.lineTo(x+Math.cos(a0)*R*1.45,y+Math.sin(a0)*R*1.45);
  g.moveTo(x,y); g.lineTo(x+Math.cos(a1)*R*1.45,y+Math.sin(a1)*R*1.45);
  g.stroke(); g.restore();
  g.beginPath(); g.arc(x,y,R,Math.min(a0,a1),Math.max(a0,a1)); g.stroke();
  const e0=[x+Math.cos(a0)*R,y+Math.sin(a0)*R], e1=[x+Math.cos(a1)*R,y+Math.sin(a1)*R];
  const t0=[-Math.sin(a0),Math.cos(a0)], t1=[-Math.sin(a1),Math.cos(a1)];
  const sgn=d>0?1:-1;
  arrow(g,e0[0],e0[1],-t0[0]*sgn,-t0[1]*sgn);
  arrow(g,e1[0],e1[1],t1[0]*sgn,t1[1]*sgn);
  const am=(a0+a1)/2;
  dimText(g,x+Math.cos(am)*(R+15),y+Math.sin(am)*(R+15),txt,col);
}
function axisOf(v){ for(let i=0;i<3;i++) if(Math.abs(v[i])>0.98) return i; return -1; }

/* ---------- dimension line hover/visibility ----------
   Lines are hit-tested by identity of the object they measure (a step segment,
   a fitted feature, an angle...) so the highlight survives the next repaint -
   the same trick the measurements-table hover already relies on (S.hi/S.hiStep). */
let DIMS_ON=true, HOVERDIM=null;
const DIMHIT=[];
function distToSegSq(px,py,x1,y1,x2,y2){
  const dx=x2-x1,dy=y2-y1,L2=dx*dx+dy*dy;
  let t=L2?((px-x1)*dx+(py-y1)*dy)/L2:0;
  t=Math.max(0,Math.min(1,t));
  const cx=x1+t*dx,cy=y1+t*dy;
  return (px-cx)*(px-cx)+(py-cy)*(py-cy);
}
function hitTestDim(x,y){
  const THRESH=64; // 8px
  let best=null,bestD=THRESH;
  for(const it of DIMHIT) for(const s of it.segs){
    const d=distToSegSq(x,y,s[0],s[1],s[2],s[3]);
    if(d<bestD){ bestD=d; best=it.obj; }
  }
  return best;
}
function angleLegSegs(x,y,dx,dy){
  const R=25*1.45;
  const L=Math.hypot(dx,dy)||1; dx/=L; dy/=L;
  let a1=Math.atan2(dy,dx);
  const a0=Math.cos(a1)>=0?0:Math.PI;
  let d=a1-a0; while(d>Math.PI)d-=2*Math.PI; while(d<-Math.PI)d+=2*Math.PI;
  a1=a0+d;
  return [[x,y,x+Math.cos(a0)*R,y+Math.sin(a0)*R],[x,y,x+Math.cos(a1)*R,y+Math.sin(a1)*R]];
}

/* ---------- annotations ---------- */
function annotate(g,P,V,M,A,scale,ctr,proj,S,isSec){
  if(!S.forExport&&!DIMS_ON) return;
  const hover=S.forExport?null:HOVERDIM;
  const visible=obj=>!hover||hover===obj;
  const isHover=obj=>hover===obj;
  const reg=(obj,segs)=>{ if(!S.forExport) DIMHIT.push({obj,pane:P,segs}); };
  // a hovered step's witness ticks sit in the margin, not on the feature that caused
  // it (e.g. a short cylindrical band between two fillets) - draw a line straight
  // through the drawing at that exact level so it's obvious which edge it is
  const hoverGuideH=y=>{
    g.save(); g.strokeStyle=RED; g.lineWidth=1; g.setLineDash([7,4]); g.globalAlpha=.55;
    g.beginPath(); g.moveTo(P.x+2,y); g.lineTo(P.x+P.w-2,y); g.stroke(); g.restore();
  };
  const hoverGuideV=x=>{
    g.save(); g.strokeStyle=RED; g.lineWidth=1; g.setLineDash([7,4]); g.globalAlpha=.55;
    g.beginPath(); g.moveTo(x,P.y+2); g.lineTo(x,P.y+P.h-2); g.stroke(); g.restore();
  };

  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(let i=0;i<8;i++){
    const p=proj([i&1?M.mx[0]:M.mn[0],i&2?M.mx[1]:M.mn[1],i&4?M.mx[2]:M.mn[2]]);
    x0=Math.min(x0,p[0]);x1=Math.max(x1,p[0]);y0=Math.min(y0,p[1]);y1=Math.max(y1,p[1]);
  }
  const hAx=axisOf(V.r), vAx=axisOf(V.u);
  const chainV=A.steps.find(s=>s.ai===vAx), chainH=A.steps.find(s=>s.ai===hAx);
  const levelPt=(ai,t)=>{const p=[ctr[0],ctr[1],ctr[2]];p[ai]=t;return proj(p);};

  if(chainV){
    const baseX=Math.max(x0-26,P.x+16);
    let prevMid=null, stagger=0;
    for(const sg of chainV.segs){
      const ya=levelPt(vAx,sg.a)[1], yb=levelPt(vAx,sg.b)[1];
      if(Math.abs(ya-yb)<9) continue;
      const mid=(ya+yb)/2;
      // consecutive short segments can put their labels close enough to collide -
      // step the dimension line outward until there's clear air between them
      stagger=(prevMid!==null&&Math.abs(mid-prevMid)<13)?stagger+1:0;
      const dimX=baseX-stagger*15;
      reg(sg,[[dimX,ya,dimX,yb]]);
      if(visible(sg)) dimV(g,ya,yb,x0,dimX,S.fmt(sg.len),S.hiStep===sg||isHover(sg));
      if(isHover(sg)){ hoverGuideH(ya); hoverGuideH(yb); }
      prevMid=mid;
    }
  }
  if(chainH&&!isSec){
    const baseY=Math.min(y1+26,P.y+P.h-16);
    let prevMid=null, stagger=0;
    for(const sg of chainH.segs){
      const xa=levelPt(hAx,sg.a)[0], xb=levelPt(hAx,sg.b)[0];
      if(Math.abs(xa-xb)<26) continue;
      const mid=(xa+xb)/2;
      stagger=(prevMid!==null&&Math.abs(mid-prevMid)<30)?stagger+1:0;
      const dimY=Math.min(baseY+stagger*15,P.y+P.h-16);
      reg(sg,[[xa,dimY,xb,dimY]]);
      if(visible(sg)) dimH(g,xa,xb,y1,dimY,S.fmt(sg.len),S.hiStep===sg||isHover(sg));
      if(isHover(sg)){ hoverGuideV(xa); hoverGuideV(xb); }
      prevMid=mid;
    }
  }
  {
    const dimX=Math.max(x0-(chainV?54:26),P.x+12), kOV=V.name+"|overallV";
    reg(kOV,[[dimX,y0,dimX,y1]]);
    if(visible(kOV)) dimV(g,y0,y1,x0,dimX,S.fmt((y1-y0)/scale),isHover(kOV));
    if(isHover(kOV)){ hoverGuideH(y0); hoverGuideH(y1); }
  }

  const axial=[],lateral=[];
  for(const f of A.feats){
    if(f.kind==="sph") continue;
    const d=Math.abs(f.axis[0]*V.f[0]+f.axis[1]*V.f[1]+f.axis[2]*V.f[2]);
    if(d>0.94) axial.push(f); else if(d<0.15) lateral.push(f);
  }

  if(isSec){
    // a section shows real edges, so diameters get proper dimension lines
    lateral.sort((a,b)=>b.radius-a.radius);
    let k=0;
    for(const c of lateral.slice(0,4)){
      const m=proj(c.mid), R=(c.kind==="cone"?Math.max(c.r0,c.r1):c.radius)*scale;
      const dy=Math.min(y1+24+k*19,P.y+P.h-14);
      reg(c,[[m[0]-R,dy,m[0]+R,dy]]);
      if(visible(c)) dimH(g,m[0]-R,m[0]+R,y1,dy,"\u00D8"+S.fmt(2*(c.kind==="cone"?Math.max(c.r0,c.r1):c.radius)),c===S.hi||isHover(c));
      k++;
    }
  } else {
    const dyOH=Math.min(y1+(chainH?54:26),P.y+P.h-12), kOH=V.name+"|overallH";
    reg(kOH,[[x0,dyOH,x1,dyOH]]);
    if(visible(kOH)) dimH(g,x0,x1,y1,dyOH,S.fmt((x1-x0)/scale),isHover(kOH));
    if(isHover(kOH)){ hoverGuideV(x0); hoverGuideV(x1); }
    // bores seen from the side: dashed walls plus a centre line
    for(const c of lateral){
      if(!c.hole||c.kind!=="cyl") continue;
      const a=proj(c.p0),b=proj(c.p1);
      let dx=b[0]-a[0],dy=b[1]-a[1];const L=Math.hypot(dx,dy)||1;dx/=L;dy/=L;
      const px=-dy*c.radius*scale, py=dx*c.radius*scale;
      reg(c,[[a[0]+px,a[1]+py,b[0]+px,b[1]+py],[a[0]-px,a[1]-py,b[0]-px,b[1]-py]]);
      if(!visible(c)) continue;
      const on=c===S.hi||isHover(c);
      g.save();
      g.strokeStyle=on?RED:HIDDEN; g.lineWidth=on?1.3:.95; g.setLineDash([6,3.5]);
      g.beginPath();
      g.moveTo(a[0]+px,a[1]+py); g.lineTo(b[0]+px,b[1]+py);
      g.moveTo(a[0]-px,a[1]-py); g.lineTo(b[0]-px,b[1]-py);
      g.stroke();
      g.setLineDash([9,3,2.5,3]); g.strokeStyle=CENTRE; g.lineWidth=.7;
      g.beginPath(); g.moveTo(a[0]-dx*6,a[1]-dy*6); g.lineTo(b[0]+dx*6,b[1]+dy*6); g.stroke();
      g.restore();
    }
    lateral.sort((a,b)=>b.radius-a.radius);
    let k=0;
    for(const c of lateral){
      if(k>=3) break;
      const a=proj(c.p0),b=proj(c.p1);
      let dx=b[0]-a[0],dy=b[1]-a[1];const L=Math.hypot(dx,dy)||1;dx/=L;dy/=L;
      const span=Math.abs(dy)>Math.abs(dx)?x1-x0:y1-y0;
      const rad=(c.kind==="cone"?Math.max(c.r0,c.r1):c.radius);
      if(Math.abs(rad*2*scale-span)<3){ continue; }
      const side=k%2?-1:1, t=[0.32,0.32,0.62][k];
      const px=-dy*rad*scale*side, py=dx*rad*scale*side;
      const ux=-dy*side, uy=dx*side;
      const ax=a[0]+(b[0]-a[0])*t+px, ay=a[1]+(b[1]-a[1])*t+py;
      const lx=ax+ux*20, ly=ay+uy*20, dir=ux>=0?1:-1, tx=lx+dir*14;
      reg(c,[[ax,ay,lx,ly],[lx,ly,tx,ly]]);
      if(visible(c)) leader(g,ax,ay,ux,uy,20,"\u00D8"+S.fmt(2*rad),c===S.hi||isHover(c));
      k++;
    }
  }

  // spheres: SR with a leader onto the arc
  const sphs=A.feats.filter(f=>f.kind==="sph").sort((a,b)=>b.radius-a.radius);
  let si=0;
  for(const s of sphs.slice(0,isSec?2:1)){
    const m=proj(s.c), R=s.radius*scale;
    const th=[-2.3,-0.85][si%2];
    const ux=Math.cos(th), uy=Math.sin(th);
    const ax=m[0]+ux*R, ay=m[1]+uy*R;
    const lx=ax+ux*18, ly=ay+uy*18, dir=ux>=0?1:-1, tx=lx+dir*14;
    reg(s,[[m[0]-7,m[1],m[0]+7,m[1]],[m[0],m[1]-7,m[0],m[1]+7],[ax,ay,lx,ly],[lx,ly,tx,ly]]);
    if(visible(s)){
      g.save(); g.strokeStyle=CENTRE; g.lineWidth=.7; g.setLineDash([8,3,2.5,3]);
      g.beginPath(); g.moveTo(m[0]-7,m[1]); g.lineTo(m[0]+7,m[1]);
      g.moveTo(m[0],m[1]-7); g.lineTo(m[0],m[1]+7); g.stroke(); g.restore();
      leader(g,ax,ay,ux,uy,18,"SR"+S.fmt(s.radius),s===S.hi||isHover(s));
    }
    si++;
  }

  // cones and tilted faces: true angle, shown where the face is edge on
  let na=0;
  for(const a of A.angles){
    if(na>=1) break;
    if(Math.abs(a.n[0]*V.f[0]+a.n[1]*V.f[1]+a.n[2]*V.f[2])>0.08) continue;
    const nr=a.n[0]*V.r[0]+a.n[1]*V.r[1]+a.n[2]*V.r[2];
    const nu=a.n[0]*V.u[0]+a.n[1]*V.u[1]+a.n[2]*V.u[2];
    const c=proj(a.centroid);
    reg(a,angleLegSegs(c[0],c[1],-nu,nr));
    if(visible(a)) dimAngle(g,c[0],c[1],-nu,nr,a.deg.toFixed(1)+"\u00B0",a===S.hi||isHover(a));
    na++;
  }
  for(const f of A.feats){
    if(f.kind!=="cone") continue;
    if(Math.abs(f.axis[0]*V.f[0]+f.axis[1]*V.f[1]+f.axis[2]*V.f[2])>0.15) continue;
    const m=proj(f.mid);
    const ux=1,uy=-0.6;
    const lx=m[0]+ux*26, ly=m[1]+uy*26, dir=ux>=0?1:-1, tx=lx+dir*14;
    reg(f,[[m[0],m[1],lx,ly],[lx,ly,tx,ly]]);
    if(visible(f)) leader(g,m[0],m[1],1,-0.6,26,(2*f.half*180/Math.PI).toFixed(1)+"\u00B0 incl",f===S.hi||isHover(f));
    break;
  }

  // holes seen end on
  axial.sort((a,b)=>b.radius-a.radius);
  const angles=[-0.7,-2.35,0.75,2.4,-1.5,1.6];
  let j=0;
  for(const c of axial.slice(0,6)){
    if(c.kind!=="cyl") continue;
    const m=proj(c.mid), R=c.radius*scale;
    const th=angles[j++%angles.length];
    const ux=Math.cos(th), uy=Math.sin(th);
    const ax=m[0]+ux*R, ay=m[1]+uy*R;
    const lx=ax+ux*17, ly=ay+uy*17, dir=ux>=0?1:-1, tx=lx+dir*14;
    reg(c,[[m[0]-R-5,m[1],m[0]+R+5,m[1]],[m[0],m[1]-R-5,m[0],m[1]+R+5],[ax,ay,lx,ly],[lx,ly,tx,ly]]);
    if(!visible(c)) continue;
    const on=c===S.hi||isHover(c);
    g.save(); g.strokeStyle=CENTRE; g.lineWidth=.7; g.setLineDash([8,3,2.5,3]);
    g.beginPath();
    g.moveTo(m[0]-R-5,m[1]); g.lineTo(m[0]+R+5,m[1]);
    g.moveTo(m[0],m[1]-R-5); g.lineTo(m[0],m[1]+R+5);
    g.stroke(); g.restore();
    if(on){ g.save(); g.strokeStyle=RED; g.lineWidth=1.8;
      g.beginPath(); g.arc(m[0],m[1],R,0,7); g.stroke(); g.restore(); }
    leader(g,ax,ay,ux,uy,17,
           "\u00D8"+S.fmt(c.radius*2)+(c.through?" THRU":(c.hole?" \u2193"+S.fmt(c.len):"")),on);
  }
}

function drawTitleBlock(g,B,M,S,scale,standard){
  g.strokeStyle=PENCIL; g.lineWidth=1;
  const cells=[
    ["FILE",S.name],
    ["VOLUME",S.fmt3(M.volume/Math.pow(S.k,3))+" "+S.u+"\u00B3"],
    ["EXTENTS  X \u00D7 Y \u00D7 Z",[0,1,2].map(i=>S.fmt(M.mx[i]-M.mn[i])).join(" \u00D7 ")],
    ["TRIANGLES",M.nf.toLocaleString()],
    ["UNITS",S.u+"  \u00B7  "+(scale>=1?scale.toFixed(2)+":1":"1:"+(1/scale).toFixed(2))],
    ["MESH",M.watertight?"closed":"open \u00B7 "+M.openEdges+" free edges"],
  ];
  const n=cells.length,w=B.w/n;
  g.strokeRect(B.x+.5,B.y+.5,B.w-1,B.h-1);
  for(let i=0;i<n;i++){
    const x=B.x+i*w;
    if(i){ g.beginPath(); g.moveTo(x+.5,B.y); g.lineTo(x+.5,B.y+B.h); g.lineWidth=.7; g.stroke(); }
    g.font='9px ui-monospace,"SF Mono",Menlo,Consolas,monospace';
    g.fillStyle=DIM_TEXT; g.textAlign="left"; g.textBaseline="top";
    g.fillText(cells[i][0],x+8,B.y+8);
    g.font='600 12px ui-monospace,"SF Mono",Menlo,Consolas,monospace';
    g.fillStyle=PENCIL;
    let t=cells[i][1];
    while(g.measureText(t).width>w-16&&t.length>4) t=t.slice(0,-2)+"\u2026";
    g.fillText(t,x+8,B.y+24);
  }
  if(!standard){
    g.font=MONO; g.fillStyle=DIM_TEXT; g.textAlign="right"; g.textBaseline="bottom";
    g.fillText("views rearranged \u2014 see pane labels",B.x+B.w-10,B.y+B.h-8);
    g.textAlign="left"; return;
  }
  const sx=B.x+B.w-46, sy=B.y+B.h-20;
  g.save(); g.strokeStyle=PENCIL; g.lineWidth=.9;
  g.beginPath(); g.arc(sx,sy,8,0,7); g.stroke();
  g.beginPath(); g.arc(sx,sy,4,0,7); g.stroke();
  g.beginPath(); g.moveTo(sx+14,sy-8); g.lineTo(sx+30,sy-5); g.lineTo(sx+30,sy+5); g.lineTo(sx+14,sy+8);
  g.closePath(); g.stroke();
  g.setLineDash([5,2,1.5,2]); g.lineWidth=.6;
  g.beginPath(); g.moveTo(sx-12,sy); g.lineTo(sx+34,sy); g.stroke();
  g.restore();
}
/* ============================================================
   Vector export
   ============================================================ */

/* A stand-in for a 2D context that records what was drawn instead of
   rasterising it. Lets SVG and DXF reuse the real renderer. */
function Rec(){
  this.items=[]; this.phase="frame"; this.view=null; this.pane=null;
  this.m=[1,0,0,1,0,0]; this.stack=[]; this.clipRect=null; this.clipStack=[];
  this.fillStyle="#000"; this.strokeStyle="#000"; this.lineWidth=1;
  this.font="11px monospace"; this.textAlign="start"; this.textBaseline="alphabetic";
  this.lineJoin="round"; this.lineCap="round"; this.dash=[];
  this.cur=[]; this.sub=null;
}
Rec.prototype.__mark=function(ph,V,P){ this.phase=ph; if(V)this.view=V; if(P)this.pane=P; };
Rec.prototype._t=function(x,y){
  const m=this.m; return [m[0]*x+m[2]*y+m[4], m[1]*x+m[3]*y+m[5]];
};
Rec.prototype.save=function(){
  this.stack.push([this.m.slice(),this.fillStyle,this.strokeStyle,this.lineWidth,
                   this.font,this.textAlign,this.textBaseline,this.dash.slice()]);
  this.clipStack.push(this.clipRect);
};
Rec.prototype.restore=function(){
  const s=this.stack.pop(); if(s){
    this.m=s[0]; this.fillStyle=s[1]; this.strokeStyle=s[2]; this.lineWidth=s[3];
    this.font=s[4]; this.textAlign=s[5]; this.textBaseline=s[6]; this.dash=s[7];
  }
  if(this.clipStack.length) this.clipRect=this.clipStack.pop();
};
Rec.prototype.setTransform=function(a,b,c,d,e,f){ this.m=[a,b,c,d,e,f]; };
Rec.prototype.translate=function(x,y){
  const m=this.m; m[4]+=m[0]*x+m[2]*y; m[5]+=m[1]*x+m[3]*y;
};
Rec.prototype.rotate=function(a){
  const c=Math.cos(a),s=Math.sin(a),m=this.m;
  this.m=[m[0]*c+m[2]*s, m[1]*c+m[3]*s, m[2]*c-m[0]*s, m[3]*c-m[1]*s, m[4], m[5]];
};
Rec.prototype.setLineDash=function(d){ this.dash=d?d.slice():[]; };
Rec.prototype.beginPath=function(){ this.cur=[]; this.sub=null; };
Rec.prototype.moveTo=function(x,y){ this.sub=[this._t(x,y)]; this.cur.push(this.sub); };
Rec.prototype.lineTo=function(x,y){ if(!this.sub) this.moveTo(x,y); else this.sub.push(this._t(x,y)); };
Rec.prototype.closePath=function(){ if(this.sub&&this.sub.length>1) this.sub.push(this.sub[0].slice()); };
Rec.prototype.rect=function(x,y,w,h){
  this.moveTo(x,y); this.lineTo(x+w,y); this.lineTo(x+w,y+h); this.lineTo(x,y+h); this.closePath();
};
Rec.prototype.arc=function(x,y,r,a0,a1,ccw){
  let d=a1-a0;
  if(!ccw){ while(d<0)d+=2*Math.PI; } else { while(d>0)d-=2*Math.PI; }
  if(Math.abs(d)>2*Math.PI) d=Math.sign(d)*2*Math.PI;
  const n=Math.max(6,Math.ceil(Math.abs(d)/0.14));
  for(let i=0;i<=n;i++){
    const a=a0+d*i/n, px=x+Math.cos(a)*r, py=y+Math.sin(a)*r;
    if(i===0&&!this.sub) this.moveTo(px,py); else this.lineTo(px,py);
  }
  // remember the true circle/arc so DXF can emit a real curve
  this._lastArc={c:this._t(x,y),r:r*Math.hypot(this.m[0],this.m[1]),a0,a1:a0+d};
};
Rec.prototype._push=function(kind,style){
  if(!this.cur.length) return;
  this.items.push({kind,phase:this.phase,view:this.view,pane:this.pane,clip:this.clipRect,
    subs:this.cur.map(s=>s.map(p=>p.slice())),style,
    arc:this._lastArc&&this.cur.length===1?this._lastArc:null});
  this._lastArc=null;
};
Rec.prototype.stroke=function(){
  this._push("stroke",{colour:this.strokeStyle,width:this.lineWidth,dash:this.dash.slice()});
};
Rec.prototype.fill=function(){ this._push("fill",{colour:this.fillStyle}); };
Rec.prototype.clip=function(){
  const pts=[].concat(...this.cur);
  if(pts.length){
    let x0=1e30,y0=1e30,x1=-1e30,y1=-1e30;
    for(const p of pts){ x0=Math.min(x0,p[0]);y0=Math.min(y0,p[1]);x1=Math.max(x1,p[0]);y1=Math.max(y1,p[1]); }
    this.clipRect=[x0,y0,x1,y1];
  }
};
Rec.prototype.fillRect=function(x,y,w,h){
  const save=this.cur, saveSub=this.sub;
  this.beginPath(); this.rect(x,y,w,h); this.fill();
  this.cur=save; this.sub=saveSub;
};
Rec.prototype.strokeRect=function(x,y,w,h){
  const save=this.cur, saveSub=this.sub;
  this.beginPath(); this.rect(x,y,w,h); this.stroke();
  this.cur=save; this.sub=saveSub;
};
Rec.prototype.clearRect=function(){};
Rec.prototype.measureText=function(t){
  const m=/(\d+(?:\.\d+)?)px/.exec(this.font);
  return {width:(m?+m[1]:11)*0.601*t.length};
};
Rec.prototype.fillText=function(t,x,y){
  if(!t) return;
  const m=/(\d+(?:\.\d+)?)px/.exec(this.font);
  const size=(m?+m[1]:11)*Math.hypot(this.m[0],this.m[1]);
  const rot=Math.atan2(this.m[1],this.m[0]);
  this.items.push({kind:"text",phase:this.phase,view:this.view,pane:this.pane,clip:this.clipRect,
    text:t,at:this._t(x,y),size,rot,align:this.textAlign,baseline:this.textBaseline,
    colour:this.fillStyle,bold:/600|bold/.test(this.font)});
};

function recordSheet(M,A,S,cssW){
  S=Object.assign({},S,{forExport:true,hi:null,hiStep:null});
  const L=sheetLayout(cssW||1180,M,S);
  const r=new Rec();
  paintSheet(r,L,M,A,S);
  return {rec:r,L};
}

/* Build the sheet as vector items. On screen the orthographic views only read
   correctly because nearer faces were painted over the ones behind; in a vector
   file there is no paint order to rely on, so those get recomputed with real
   hidden line removal and emitted as line art. */
function vectorSheet(M,A,S,cssW,shadeIso){
  const {rec,L}=recordSheet(M,A,S,cssW);
  const bias=M.diag*0.0035;
  const hlr=new Map();
  for(let i=0;i<4;i++){
    const V=L.views[i], P=L.panes[i];
    if(V.name==="ISO"&&shadeIso) continue;
    let keep=null;
    if(V.name.indexOf("SECTION")===0){
      keep=new Uint8Array(M.nf);
      const cutD=L.ctr[0]*V.f[0]+L.ctr[1]*V.f[1]+L.ctr[2]*V.f[2], eps=M.diag*1e-6;
      for(let f=0;f<M.nf;f++){
        let ok=1;
        for(let c=0;c<3;c++){
          const vi=M.face[f*3+c];
          if(M.V[vi*3]*V.f[0]+M.V[vi*3+1]*V.f[1]+M.V[vi*3+2]*V.f[2]-cutD<-eps){ ok=0; break; }
        }
        keep[f]=ok;
      }
    }
    hlr.set(P,{view:V,segs:visibleSegments(M,V,L.scale,L.ctr,P,keep,bias)});
  }
  // splice the line art in where the painted mesh used to be
  const items=[], done=new Set();
  for(const it of rec.items){
    if(it.phase==="mesh"&&hlr.has(it.pane)){
      if(!done.has(it.pane)){
        done.add(it.pane);
        const h=hlr.get(it.pane);
        items.push({kind:"mesh",phase:"mesh",view:h.view,pane:it.pane,clip:it.clip,segs:h.segs});
      }
      continue;
    }
    items.push(it);
  }
  return {L,items};
}

/* ---------- SVG ---------- */
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
function toSVG(M,A,S,cssW,shadeIso){
  const {L,items}=vectorSheet(M,A,S,cssW,shadeIso!==false);
  const rec={items};
  const F="ui-monospace,'SF Mono',Menlo,Consolas,monospace";
  const out=[`<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${L.cssW}" height="${L.cssH}" viewBox="0 0 ${L.cssW} ${L.cssH}">`,
    `<title>${esc(S.name||"part")} — STL Blueprint</title>`,`<defs>`];
  const clips=new Map();
  for(const it of rec.items){
    if(!it.clip) continue;
    const k=it.clip.join(",");
    if(!clips.has(k)){
      const id="c"+clips.size;
      clips.set(k,id);
      out.push(`<clipPath id="${id}"><rect x="${f2(it.clip[0])}" y="${f2(it.clip[1])}" width="${f2(it.clip[2]-it.clip[0])}" height="${f2(it.clip[3]-it.clip[1])}"/></clipPath>`);
    }
  }
  out.push(`</defs>`);
  let open=null;
  const setClip=c=>{
    const id=c?clips.get(c.join(",")):null;
    if(id===open) return;
    if(open!==null) out.push("</g>");
    open=id;
    if(id) out.push(`<g clip-path="url(#${id})">`); else open=null;
  };
  for(const it of rec.items){
    setClip(it.clip);
    if(it.kind==="mesh"){
      const d=it.segs.map(s=>"M"+f2(s[0][0])+" "+f2(s[0][1])+"L"+f2(s[1][0])+" "+f2(s[1][1])).join("");
      if(d) out.push(`<path d="${d}" fill="none" stroke="${PENCIL}" stroke-width="1.05" stroke-linecap="round"/>`);
      continue;
    }
    if(it.kind==="text"){
      const anchor=it.align==="center"?"middle":it.align==="right"?"end":"start";
      const dy=it.baseline==="middle"?"0.35em":it.baseline==="top"?"0.95em":it.baseline==="bottom"?"-0.1em":"0";
      const rot=it.rot?` transform="rotate(${f2(it.rot*180/Math.PI)} ${f2(it.at[0])} ${f2(it.at[1])})"`:"";
      out.push(`<text x="${f2(it.at[0])}" y="${f2(it.at[1])}" dy="${dy}" font-family="${F}" font-size="${f2(it.size)}"`+
        (it.bold?' font-weight="600"':"")+` text-anchor="${anchor}" fill="${it.colour}"${rot}>${esc(it.text)}</text>`);
      continue;
    }
    const d=it.subs.map(s=>"M"+s.map(p=>f2(p[0])+" "+f2(p[1])).join("L")).join("");
    if(!d) continue;
    if(it.kind==="fill") out.push(`<path d="${d}" fill="${it.style.colour}" fill-rule="evenodd" stroke="none"/>`);
    else out.push(`<path d="${d}" fill="none" stroke="${it.style.colour}" stroke-width="${f2(it.style.width)}"`+
      (it.style.dash.length?` stroke-dasharray="${it.style.dash.map(f2).join(",")}"`:"")+
      ` stroke-linejoin="round" stroke-linecap="round"/>`);
  }
  if(open!==null) out.push("</g>");
  out.push("</svg>");
  return out.join("\n");
}
function f2(v){ return Math.abs(v)<1e-9?0:+(+v).toFixed(2); }

/* ---------- hidden line removal, for line-art formats ----------
   Rasterise face depth into a buffer, then keep only the stretches of each
   candidate edge that are not behind something. */
function depthBuffer(M,V,scale,ctr,P,ss){
  const W=Math.max(4,Math.ceil(P.w*ss)), H=Math.max(4,Math.ceil(P.h*ss));
  const Z=new Float32Array(W*H).fill(1e30);
  const nV=M.V.length/3;
  const bx=new Float32Array(nV), by=new Float32Array(nV), bz=new Float32Array(nV);
  const cx=P.x+P.w/2, cy=P.y+P.h/2;
  for(let i=0;i<nV;i++){
    const x=M.V[i*3]-ctr[0], y=M.V[i*3+1]-ctr[1], z=M.V[i*3+2]-ctr[2];
    bx[i]=(cx+(x*V.r[0]+y*V.r[1]+z*V.r[2])*scale-P.x)*ss;
    by[i]=(cy+(x*V.u[0]+y*V.u[1]+z*V.u[2])*scale-P.y)*ss;
    bz[i]=x*V.f[0]+y*V.f[1]+z*V.f[2];
  }
  for(let f=0;f<M.nf;f++){
    const a=M.face[f*3],b=M.face[f*3+1],c=M.face[f*3+2];
    const ax=bx[a],ay=by[a],az=bz[a],px=bx[b],py=by[b],pz=bz[b],qx=bx[c],qy=by[c],qz=bz[c];
    const den=(py-qy)*(ax-qx)+(qx-px)*(ay-qy);
    if(Math.abs(den)<1e-9) continue;
    let x0=Math.max(0,Math.floor(Math.min(ax,px,qx))), x1=Math.min(W-1,Math.ceil(Math.max(ax,px,qx)));
    let y0=Math.max(0,Math.floor(Math.min(ay,py,qy))), y1=Math.min(H-1,Math.ceil(Math.max(ay,py,qy)));
    for(let Y=y0;Y<=y1;Y++){
      const fy=Y+0.5;
      for(let X=x0;X<=x1;X++){
        const fx=X+0.5;
        const w0=((py-qy)*(fx-qx)+(qx-px)*(fy-qy))/den;
        if(w0<-1e-6) continue;
        const w1=((qy-ay)*(fx-qx)+(ax-qx)*(fy-qy))/den;
        if(w1<-1e-6) continue;
        const w2=1-w0-w1;
        if(w2<-1e-6) continue;
        const z=w0*az+w1*pz+w2*qz, k=Y*W+X;
        if(z<Z[k]) Z[k]=z;
      }
    }
  }
  return {Z,W,H,bx,by,bz,ss,P};
}
function outlineEdgeList(M,V,keep){
  const front=new Uint8Array(M.nf);
  for(let f=0;f<M.nf;f++) front[f]=(M.fn[f*3]*V.f[0]+M.fn[f*3+1]*V.f[1]+M.fn[f*3+2]*V.f[2])<0?1:0;
  const out=[];
  for(let e=0;e<M.edges.length;e++){
    const E=M.edges[e];
    if(keep&&!keep[E.f1]&&(E.f2<0||!keep[E.f2])) continue;
    if(keep&&E.f2>=0&&(!keep[E.f1]||!keep[E.f2])) continue;
    let show=false;
    if(E.f2<0) show=true;
    else if(front[E.f1]!==front[E.f2]) show=true;
    else{
      const d=M.fn[E.f1*3]*M.fn[E.f2*3]+M.fn[E.f1*3+1]*M.fn[E.f2*3+1]+M.fn[E.f1*3+2]*M.fn[E.f2*3+2];
      if(d<0.9063) show=true;
    }
    if(show&&(front[E.f1]||(E.f2>=0&&front[E.f2]))) out.push(e);
  }
  return out;
}
function visibleSegments(M,V,scale,ctr,P,keep,bias){
  const B=depthBuffer(M,V,scale,ctr,P,2);
  const list=outlineEdgeList(M,V,keep);
  const segs=[], {Z,W,H,bx,by,bz,ss}=B;
  const at=(x,y)=>{
    const X=Math.floor(x), Y=Math.floor(y);
    let m=-1e30;
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
      const px=X+dx, py=Y+dy;
      if(px<0||py<0||px>=W||py>=H) return 1e30;   // touches open space: visible
      const v=Z[py*W+px];
      if(v>m) m=v;
    }
    return m;
  };
  for(const e of list){
    const E=M.edges[e], a=E.a, b=E.b;
    const x0=bx[a],y0=by[a],z0=bz[a],x1=bx[b],y1=by[b],z1=bz[b];
    const L=Math.hypot(x1-x0,y1-y0);
    const n=Math.max(2,Math.min(600,Math.ceil(L)));
    let run=-1;
    for(let i=0;i<=n;i++){
      const t=i/n, x=x0+(x1-x0)*t, y=y0+(y1-y0)*t, z=z0+(z1-z0)*t;
      const vis=z<=at(x,y)+bias;
      if(vis&&run<0) run=t;
      else if(!vis&&run>=0){ push(run,(i-1)/n); run=-1; }
    }
    if(run>=0) push(run,1);
    function push(t0,t1){
      if(t1-t0<1e-6&&L>2) return;
      const s=[[P.x+(x0+(x1-x0)*t0)/ss, P.y+(y0+(y1-y0)*t0)/ss],
               [P.x+(x0+(x1-x0)*t1)/ss, P.y+(y0+(y1-y0)*t1)/ss]];
      if(Math.hypot(s[1][0]-s[0][0],s[1][1]-s[0][1])<0.35) return;
      segs.push(s);
    }
  }
  return segs;
}

/* ---------- DXF (R12 ASCII — the most widely readable flavour) ---------- */
const DXF_LAYER={OUTLINE:7,HIDDEN:8,CENTRE:4,SECTION:3,HATCH:9,DIMS:5,TEXT:5,FRAME:8,PICTORIAL:8,FITTED:6};
/* DXF R12 carries text in a single code page, so fold anything outside
   cp1252 down to the CAD conventions rather than emitting broken bytes. */
function dxfStr(t){
  return String(t)
    .replace(/\u2193\s*/g,"DEEP ").replace(/\u2192/g,"->").replace(/\u2191/g,"^")
    .replace(/\u2190/g,"<-").replace(/\u2026/g,"...").replace(/[\u2013\u2014]/g,"-")
    .replace(/[^\x20-\xFF]/g,"?");
}
function dxfBytes(str){
  const out=new Uint8Array(str.length);
  for(let i=0;i<str.length;i++) out[i]=str.charCodeAt(i)&0xFF;
  return out;
}
function dxfLayerFor(it){
  const c=(it.style?it.style.colour:it.colour)||"";
  if(c===BLUE||c===RED) return "DIMS";
  if(c===CENTRE) return "CENTRE";
  if(c===HATCH) return "HATCH";
  if(c===HIDDEN) return "HIDDEN";
  if(c===PENCIL) return it.phase==="sec"?"SECTION":(it.phase==="frame"||it.phase==="title"?"FRAME":"OUTLINE");
  return "FRAME";
}
function toDXF(M,A,S,cssW){
  const {L,items}=vectorSheet(M,A,S,cssW,false);
  const k=L.scale, H=L.cssH;
  // geometry goes out in the units the sheet is labelled in, so the file is self consistent
  const uk=k*(S.k||1);
  const X=v=>+(v/uk).toFixed(5), Y=v=>+((H-v)/uk).toFixed(5);
  const e=[];
  const g=(code,val)=>{ e.push(code); e.push(val); };
  const line=(lay,p,q)=>{
    if(Math.abs(p[0]-q[0])<1e-9&&Math.abs(p[1]-q[1])<1e-9) return;
    g(0,"LINE"); g(8,lay); g(10,X(p[0])); g(20,Y(p[1])); g(30,0); g(11,X(q[0])); g(21,Y(q[1])); g(31,0);
  };
  const poly=(lay,pts)=>{ for(let i=1;i<pts.length;i++) line(lay,pts[i-1],pts[i]); };
  const solid=(lay,pts)=>{
    const p=pts.slice(0,4); while(p.length<4) p.push(p[p.length-1]);
    g(0,"SOLID"); g(8,lay);
    g(10,X(p[0][0])); g(20,Y(p[0][1])); g(30,0);
    g(11,X(p[1][0])); g(21,Y(p[1][1])); g(31,0);
    g(12,X(p[3][0])); g(22,Y(p[3][1])); g(32,0);
    g(13,X(p[2][0])); g(23,Y(p[2][1])); g(33,0);
  };
  const text=(lay,it)=>{
    const h=it.size/uk;
    g(0,"TEXT"); g(8,lay);
    g(10,X(it.at[0])); g(20,Y(it.at[1])); g(30,0);
    g(40,+h.toFixed(4)); g(1,dxfStr(it.text));
    g(50,+(-it.rot*180/Math.PI).toFixed(3));
    const hj=it.align==="center"?1:it.align==="right"?2:0;
    const vj=it.baseline==="middle"?2:it.baseline==="top"?3:it.baseline==="bottom"?1:0;
    g(72,hj); g(73,vj);
    g(11,X(it.at[0])); g(21,Y(it.at[1])); g(31,0);
  };

  for(const it of items){
    if(it.kind==="mesh"){
      const lay=it.view.name==="ISO"?"PICTORIAL":"OUTLINE";
      for(const s of it.segs) line(lay,s[0],s[1]);
      continue;
    }
    const col=(it.style?it.style.colour:it.colour)||"";
    if(col===SHEET) continue;                       // masking pass, no meaning in CAD
    const iso=it.view&&it.view.name==="ISO";
    const lay=iso?"PICTORIAL":dxfLayerFor(it);
    if(it.kind==="text"){ if(!iso) text(lay==="DIMS"?"DIMS":"TEXT",it); continue; }
    if(it.kind==="fill"){
      if(col!==BLUE&&col!==RED) continue;            // arrowheads only
      for(const s of it.subs) if(s.length>=3&&s.length<=5) solid("DIMS",s);
      continue;
    }
    if(it.arc&&it.arc.r>0.05){
      const a=it.arc, sweep=Math.abs(a.a1-a.a0);
      if(sweep>=2*Math.PI-1e-3){
        g(0,"CIRCLE"); g(8,lay); g(10,X(a.c[0])); g(20,Y(a.c[1])); g(30,0); g(40,+(a.r/uk).toFixed(5));
      } else {
        // canvas angles run clockwise on screen; DXF runs counter-clockwise
        g(0,"ARC"); g(8,lay); g(10,X(a.c[0])); g(20,Y(a.c[1])); g(30,0); g(40,+(a.r/uk).toFixed(5));
        g(50,+(-a.a1*180/Math.PI).toFixed(3)); g(51,+(-a.a0*180/Math.PI).toFixed(3));
      }
      continue;
    }
    for(const s of it.subs) poly(lay,s);
  }

  // The whole point of fitting primitives: emit true circles at the exact
  // diameters instead of the mesh's faceted silhouette.
  for(let i=0;i<4;i++){
    const V=L.views[i], P=L.panes[i];
    if(V.name==="ISO") continue;
    const cx=P.x+P.w/2, cy=P.y+P.h/2;
    const pr=p=>[cx+((p[0]-L.ctr[0])*V.r[0]+(p[1]-L.ctr[1])*V.r[1]+(p[2]-L.ctr[2])*V.r[2])*k,
                 cy+((p[0]-L.ctr[0])*V.u[0]+(p[1]-L.ctr[1])*V.u[1]+(p[2]-L.ctr[2])*V.u[2])*k];
    const circ=(m,r)=>{ g(0,"CIRCLE"); g(8,"FITTED"); g(10,X(m[0])); g(20,Y(m[1])); g(30,0); g(40,+(r/uk).toFixed(5)); };
    for(const f of A.feats){
      if(f.kind==="cyl"||f.kind==="cone"){
        const d=Math.abs(f.axis[0]*V.f[0]+f.axis[1]*V.f[1]+f.axis[2]*V.f[2]);
        if(d<=0.94) continue;
        if(f.kind==="cyl") circ(pr(f.mid),f.radius*k);
        else { circ(pr(f.p0),f.r0*k); circ(pr(f.p1),f.r1*k); }
      } else if(f.kind==="sph"){
        const d=Math.abs(A.up[0]*V.f[0]+A.up[1]*V.f[1]+A.up[2]*V.f[2]);
        if(d>0.94) circ(pr(f.c),f.radius*k);
      }
    }
  }

  const head=[];
  const hg=(c,v)=>{ head.push(c); head.push(v); };
  hg(0,"SECTION"); hg(2,"HEADER");
  hg(9,"$ACADVER"); hg(1,"AC1009");
  hg(9,"$INSUNITS"); hg(70,S.u==="in"?1:S.u==="cm"?5:4);
  hg(9,"$DWGCODEPAGE"); hg(3,"ANSI_1252");
  hg(9,"$EXTMIN"); hg(10,0); hg(20,0); hg(30,0);
  hg(9,"$EXTMAX"); hg(10,+(L.cssW/uk).toFixed(4)); hg(20,+(L.cssH/uk).toFixed(4)); hg(30,0);
  hg(0,"ENDSEC");
  hg(0,"SECTION"); hg(2,"TABLES");
  hg(0,"TABLE"); hg(2,"LTYPE"); hg(70,3);
  const lt=(n,desc,pat)=>{
    hg(0,"LTYPE"); hg(2,n); hg(70,0); hg(3,desc); hg(72,65);
    hg(73,pat.length); hg(40,pat.reduce((s,v)=>s+Math.abs(v),0));
    for(const v of pat) hg(49,v);
  };
  lt("CONTINUOUS","Solid line",[]);
  lt("DASHED","Dashed",[ +(2.5).toFixed(2), -(1.5) ]);
  lt("CENTER","Centre",[ 6, -1, 1, -1 ]);
  hg(0,"ENDTAB");
  const names=Object.keys(DXF_LAYER);
  hg(0,"TABLE"); hg(2,"LAYER"); hg(70,names.length);
  for(const n of names){
    hg(0,"LAYER"); hg(2,n); hg(70,0); hg(62,DXF_LAYER[n]);
    hg(6,n==="HIDDEN"?"DASHED":n==="CENTRE"?"CENTER":"CONTINUOUS");
  }
  hg(0,"ENDTAB"); hg(0,"ENDSEC");
  hg(0,"SECTION"); hg(2,"ENTITIES");
  const tail=[0,"ENDSEC",0,"EOF"];
  const all=head.concat(e,tail);
  const out=[];
  for(let i=0;i<all.length;i+=2) out.push(String(all[i]),String(all[i+1]));
  return out.join("\r\n")+"\r\n";
}

/* ---------- measurements as CSV ---------- */
function toCSV(M,A,S){
  const q=v=>/[",\n]/.test(String(v))?'"'+String(v).replace(/"/g,'""')+'"':String(v);
  const rows=[["section","item","nominal","value","units","note"]];
  rows.push(["extents","bounding X","",S.fmt(M.mx[0]-M.mn[0]),S.u,""]);
  rows.push(["extents","bounding Y","",S.fmt(M.mx[1]-M.mn[1]),S.u,""]);
  rows.push(["extents","bounding Z","",S.fmt(M.mx[2]-M.mn[2]),S.u,""]);
  rows.push(["extents","volume","",(M.volume/Math.pow(S.k,3)).toFixed(3),S.u+"^3",""]);
  rows.push(["extents","surface area","",(M.area/Math.pow(S.k,2)).toFixed(3),S.u+"^2",""]);
  for(const f of A.feats){
    if(f.kind==="cyl")  rows.push(["feature",f.hole?"bore":"cylinder","diameter",S.fmt(f.radius*2),S.u,
      (f.through?"through":f.hole?"blind":"boss")+", length "+S.fmt(f.len)]);
    if(f.kind==="sph")  rows.push(["feature",f.hole?"cavity":"dome","radius",S.fmt(f.radius),S.u,
      (f.hole?"internal":"external")+", centre "+f.c.map(v=>S.fmt(v)).join(" ")]);
    if(f.kind==="cone") rows.push(["feature","taper","included angle",(2*f.half*180/Math.PI).toFixed(3),"deg",
      "\u00d8"+S.fmt(2*Math.min(f.r0,f.r1))+" to \u00d8"+S.fmt(2*Math.max(f.r0,f.r1))+", length "+S.fmt(f.len)]);
  }
  for(const a of A.angles) rows.push(["angle","inclined face","from base",a.deg.toFixed(3),"deg",
    (90-a.deg).toFixed(3)+" deg from axis, "+a.parts+" face(s)"]);
  for(const st of A.steps) for(const sg of st.segs)
    rows.push(["step",st.axis+" chain","",S.fmt(sg.len),S.u,
      "from "+S.fmt(sg.a-M.mn[st.ai])+" to "+S.fmt(sg.b-M.mn[st.ai])]);
  return rows.map(r=>r.map(q).join(",")).join("\r\n")+"\r\n";
}

function toJSON(M,A,S){
  const cv=v=>+(v/S.k).toFixed(6);
  return JSON.stringify({
    source:S.name, units:S.u, generator:"STL Blueprint",
    mesh:{triangles:M.nf, watertight:M.watertight, freeEdges:M.openEdges,
          volume:+(M.volume/Math.pow(S.k,3)).toFixed(6),
          surfaceArea:+(M.area/Math.pow(S.k,2)).toFixed(6),
          min:M.mn.map(cv), max:M.mx.map(cv)},
    features:A.feats.map(f=>f.kind==="cyl"
      ?{type:"cylinder",diameter:cv(f.radius*2),length:cv(f.len),internal:f.hole,through:f.through,
        axis:f.axis.map(v=>+v.toFixed(6)),from:f.p0.map(cv),to:f.p1.map(cv),fitRms:+f.rms.toFixed(6)}
      :f.kind==="sph"
      ?{type:"sphere",radius:cv(f.radius),internal:f.hole,centre:f.c.map(cv),fitRms:+f.rms.toFixed(6)}
      :{type:"cone",includedAngle:+(2*f.half*180/Math.PI).toFixed(4),
        diameterA:cv(2*f.r0),diameterB:cv(2*f.r1),length:cv(f.len),
        axis:f.axis.map(v=>+v.toFixed(6)),apex:f.apex.map(cv),fitRms:+f.rms.toFixed(6)}),
    inclinedFaces:A.angles.map(a=>({degreesFromBase:+a.deg.toFixed(4),
      degreesFromAxis:+(90-a.deg).toFixed(4),normal:a.n.map(v=>+v.toFixed(6)),faces:a.parts})),
    stepChains:A.steps.map(st=>({axis:st.axis,
      levels:st.levels.map(t=>cv(t-M.mn[st.ai])),
      steps:st.segs.map(sg=>cv(sg.len))}))
  },null,2);
}
/* ============================================================
   Machine-readable model: what a feature IS, how features relate,
   and where the geometry is tight — plus an editable rebuild script.
   ============================================================ */

/* Slice the part perpendicular to an axis and, at each level, find the
   enclosed passages. A drawing shows sizes; this shows where flow or
   assembly clearance is actually restricted. */
function crossSections(M,ai,step,px){
  const u=(ai+1)%3, v=(ai+2)%3;
  const lo=M.mn[ai], hi=M.mx[ai];
  step=step||Math.max((hi-lo)/160,M.diag*3e-3);
  const u0=M.mn[u], u1=M.mx[u], v0=M.mn[v], v1=M.mx[v];
  const res=Math.max(u1-u0,v1-v0)/(px||128);
  const W=Math.max(4,Math.ceil((u1-u0)/res)+3), H=Math.max(4,Math.ceil((v1-v0)/res)+3);
  const cell=res*res;
  const grid=new Uint8Array(W*H), lab=new Int32Array(W*H), stack=new Int32Array(W*H);
  const prev=new Int32Array(W*H), cur=new Int32Array(W*H);
  const channels=new Map(); let nextId=1;
  const out=[];
  const xs=[];
  for(let t=lo+step*0.5;t<hi;t+=step){
    // segments where this plane cuts the mesh
    const segs=[];
    for(let f=0;f<M.nf;f++){
      const a=M.face[f*3],b=M.face[f*3+1],c=M.face[f*3+2];
      const za=M.V[a*3+ai],zb=M.V[b*3+ai],zc=M.V[c*3+ai];
      if((za<t&&zb<t&&zc<t)||(za>t&&zb>t&&zc>t)) continue;
      const I=[a,b,c], Z=[za,zb,zc], hit=[];
      for(let e=0;e<3;e++){
        const p=I[e],q=I[(e+1)%3],zp=Z[e],zq=Z[(e+1)%3];
        if((zp<=t&&zq>t)||(zq<=t&&zp>t)){
          const s=(t-zp)/(zq-zp);
          hit.push([M.V[p*3+u]+s*(M.V[q*3+u]-M.V[p*3+u]),
                    M.V[p*3+v]+s*(M.V[q*3+v]-M.V[p*3+v])]);
        }
      }
      if(hit.length===2) segs.push(hit);
    }
    if(segs.length<2){ prev.fill(0); out.push({t,solid:0,passages:[]}); continue; }
    // even-odd scanline fill into a bitmap
    grid.fill(0);
    for(let y=0;y<H;y++){
      const wy=v0+(y+0.5)*res;
      xs.length=0;
      for(const s of segs){
        const y0=s[0][1],y1=s[1][1];
        if((y0<=wy&&y1>wy)||(y1<=wy&&y0>wy))
          xs.push(s[0][0]+(wy-y0)/(y1-y0)*(s[1][0]-s[0][0]));
      }
      if(xs.length<2) continue;
      xs.sort((p,q)=>p-q);
      for(let i=0;i+1<xs.length;i+=2){
        let x0=Math.max(0,Math.round((xs[i]-u0)/res)), x1=Math.min(W-1,Math.round((xs[i+1]-u0)/res));
        for(let x=x0;x<x1;x++) grid[y*W+x]=1;
      }
    }
    let solid=0;
    for(let i=0;i<W*H;i++) if(grid[i]) solid++;
    // air reachable from the border is outside; anything else is an enclosed passage
    lab.fill(0);
    let sp=0;
    for(let x=0;x<W;x++){ for(const y of [0,H-1]){ const k=y*W+x; if(!grid[k]&&!lab[k]){lab[k]=-1;stack[sp++]=k;} } }
    for(let y=0;y<H;y++){ for(const x of [0,W-1]){ const k=y*W+x; if(!grid[k]&&!lab[k]){lab[k]=-1;stack[sp++]=k;} } }
    while(sp>0){
      const k=stack[--sp], x=k%W, y=(k-x)/W;
      if(x>0){const n=k-1; if(!grid[n]&&!lab[n]){lab[n]=-1;stack[sp++]=n;}}
      if(x<W-1){const n=k+1; if(!grid[n]&&!lab[n]){lab[n]=-1;stack[sp++]=n;}}
      if(y>0){const n=k-W; if(!grid[n]&&!lab[n]){lab[n]=-1;stack[sp++]=n;}}
      if(y<H-1){const n=k+W; if(!grid[n]&&!lab[n]){lab[n]=-1;stack[sp++]=n;}}
    }
    const passages=[], comps=[];
    for(let k0=0;k0<W*H;k0++){
      if(grid[k0]||lab[k0]) continue;
      let n=0, id=comps.length+1;
      sp=0; lab[k0]=id; stack[sp++]=k0;
      while(sp>0){
        const k=stack[--sp], x=k%W, y=(k-x)/W; n++;
        if(x>0){const m=k-1; if(!grid[m]&&!lab[m]){lab[m]=id;stack[sp++]=m;}}
        if(x<W-1){const m=k+1; if(!grid[m]&&!lab[m]){lab[m]=id;stack[sp++]=m;}}
        if(y>0){const m=k-W; if(!grid[m]&&!lab[m]){lab[m]=id;stack[sp++]=m;}}
        if(y<H-1){const m=k+W; if(!grid[m]&&!lab[m]){lab[m]=id;stack[sp++]=m;}}
      }
      comps.push({id,px:n,area:n*cell});
    }
    // Follow each passage from slice to slice by pixel overlap, so a bore that
    // runs the length of the part is one channel rather than 160 loose numbers.
    const ov=new Map();
    for(let k=0;k<W*H;k++){
      const a=lab[k]; if(a<=0) continue;
      const b=prev[k]; if(b<=0) continue;
      const key=a*1048576+b; ov.set(key,(ov.get(key)||0)+1);
    }
    const pairs=[...ov.entries()].map(([k,n])=>({loc:Math.floor(k/1048576),ch:k%1048576,n}))
                                 .sort((x,y)=>y.n-x.n);
    const assigned=new Map(), taken=new Set();
    for(const pr of pairs){
      if(assigned.has(pr.loc)||taken.has(pr.ch)) continue;
      assigned.set(pr.loc,pr.ch); taken.add(pr.ch);
    }
    // everything a component overlaps, so splits and merges stay traceable
    const overlaps=new Map();
    for(const pr of pairs){
      if(!overlaps.has(pr.loc)) overlaps.set(pr.loc,[]);
      overlaps.get(pr.loc).push(pr.ch);
    }
    cur.fill(0);
    for(const cp of comps){
      let ch=assigned.get(cp.id);
      const all=overlaps.get(cp.id)||[];
      if(!ch){
        ch=nextId++;
        channels.set(ch,{id:ch,from:t,to:t,min:cp.area,minAt:t,max:cp.area,
                         startsAtEnd:out.length===0,joins:new Set()});
      }
      for(const other of all) if(other!==ch){
        channels.get(ch).joins.add(other);
        const O=channels.get(other); if(O) O.joins.add(ch);
      }
      const C=channels.get(ch);
      C.to=t; if(cp.area<C.min){C.min=cp.area;C.minAt=t;} if(cp.area>C.max)C.max=cp.area;
      cp.ch=ch;
      passages.push({area:cp.area,channel:ch});
    }
    for(let k=0;k<W*H;k++){ const a=lab[k]; cur[k]=a>0?(comps[a-1].ch||0):0; }
    prev.set(cur);
    passages.sort((a,b)=>b.area-a.area);
    out.push({t,solid:solid*cell,passages});
  }
  for(const C of channels.values()) C.endsAtEnd=(C.to>=out.length?0:0)||false;
  const last=out.length?out[out.length-1].t:0;
  for(const C of channels.values()){
    C.endsAtEnd=Math.abs(C.to-last)<step*1.01;
    C.length=C.to-C.from+step;
    C.joins=[...(C.joins||[])];
  }
  return {axis:"XYZ"[ai],ai,step,resolution:res,slices:out,channels:[...channels.values()]};
}

/* How features sit relative to one another — the part a bare list misses. */
function relationships(M,A){
  const rel=[], f=A.feats, tol=M.diag*1e-3;
  const id=x=>x.kind+"_"+(x.hole?"in":"out")+"_"+(x.radius*2).toFixed(3);
  for(let i=0;i<f.length;i++) for(let j=i+1;j<f.length;j++){
    const a=f[i], b=f[j];
    if((a.kind==="cyl")&&(b.kind==="cyl")){
      const d=Math.abs(a.axis[0]*b.axis[0]+a.axis[1]*b.axis[1]+a.axis[2]*b.axis[2]);
      if(d<0.999) continue;
      const dv=[b.base[0]-a.base[0],b.base[1]-a.base[1],b.base[2]-a.base[2]];
      const t=dv[0]*a.axis[0]+dv[1]*a.axis[1]+dv[2]*a.axis[2];
      const off=Math.hypot(dv[0]-t*a.axis[0],dv[1]-t*a.axis[1],dv[2]-t*a.axis[2]);
      if(off>tol*3) continue;
      rel.push({type:"coaxial",a:id(a),b:id(b),
        radialGap:+Math.abs(a.radius-b.radius).toFixed(6),
        note:(a.hole!==b.hole)?"wall thickness between an internal and an external face":"step between two external faces"});
    }
    if(a.kind==="sph"&&b.kind==="cyl"||a.kind==="cyl"&&b.kind==="sph"){
      const s=a.kind==="sph"?a:b, c=a.kind==="sph"?b:a;
      const dv=[s.c[0]-c.base[0],s.c[1]-c.base[1],s.c[2]-c.base[2]];
      const t=dv[0]*c.axis[0]+dv[1]*c.axis[1]+dv[2]*c.axis[2];
      const off=Math.hypot(dv[0]-t*c.axis[0],dv[1]-t*c.axis[1],dv[2]-t*c.axis[2]);
      if(off>tol*3||Math.abs(s.radius-c.radius)>tol*3) continue;
      rel.push({type:"tangent",a:id(s),b:id(c),
        note:"sphere meets the cylinder with matching radius: the surface is smooth across the join, no edge"});
    }
  }
  return rel;
}

/* A plane on its own is unbounded, which makes it dangerous to cut with.
   Measure how far the actual face reaches so a cutter can be sized to it. */
function planeExtent(M,pl){
  const n=pl.n;
  let u=Math.abs(n[0])<0.9?[1,0,0]:[0,1,0];
  let d=u[0]*n[0]+u[1]*n[1]+u[2]*n[2];
  u=[u[0]-d*n[0],u[1]-d*n[1],u[2]-d*n[2]];
  const L=Math.hypot(u[0],u[1],u[2])||1; u=[u[0]/L,u[1]/L,u[2]/L];
  const v=[n[1]*u[2]-n[2]*u[1], n[2]*u[0]-n[0]*u[2], n[0]*u[1]-n[1]*u[0]];
  let c=[0,0,0],A=0;
  for(const f of pl.faces){ const w=M.fa[f]; A+=w; for(let i=0;i<3;i++) c[i]+=w*M.fc[f*3+i]; }
  c=c.map(x=>x/A);
  let u0=1e30,u1=-1e30,v0=1e30,v1=-1e30;
  const seen=new Set();
  for(const f of pl.faces) for(let k=0;k<3;k++){
    const i=M.face[f*3+k]; if(seen.has(i)) continue; seen.add(i);
    const p=[M.V[i*3]-c[0],M.V[i*3+1]-c[1],M.V[i*3+2]-c[2]];
    const a=p[0]*u[0]+p[1]*u[1]+p[2]*u[2], b=p[0]*v[0]+p[1]*v[1]+p[2]*v[2];
    if(a<u0)u0=a; if(a>u1)u1=a; if(b<v0)v0=b; if(b>v1)v1=b;
  }
  return {u,v,centroid:c,u0,u1,v0,v1};
}
function featureId(f){
  if(f.kind==="cyl")  return (f.hole?"bore":"cyl")+"_d"+(f.radius*2).toFixed(2).replace(".","p");
  if(f.kind==="sph")  return (f.hole?"cavity":"dome")+"_r"+f.radius.toFixed(2).replace(".","p");
  return "taper_a"+(2*f.half*180/Math.PI).toFixed(1).replace(".","p");
}

function toModelJSON(M,A,S,xs){
  const c=v=>+(v/S.k).toFixed(6), c2=v=>+(v/(S.k*S.k)).toFixed(4), c3=v=>+(v/Math.pow(S.k,3)).toFixed(4);
  let biggest=0, chans=[];
  if(xs){
    for(const s of xs.slices) for(const p of s.passages) if(p.area>biggest) biggest=p.area;
    // A passage that tapers to nothing is a blind pocket, not a restriction.
    // Only channels that actually run somewhere are worth reporting.
    chans=xs.channels.filter(C=>C.length>=xs.step*3&&C.max>=biggest*0.02)
                     .sort((a,b)=>b.length-a.length);
  }
  return JSON.stringify({
    $schema:"stl-blueprint/model/1",
    generator:"STL Blueprint",
    source:S.name, units:S.u,
    datum:{note:"coordinates are the STL's own; min corner of the bounding box is the natural datum",
           origin:M.mn.map(c)},
    mesh:{triangles:M.nf, watertight:M.watertight, freeEdges:M.openEdges,
          volume:c3(M.volume), surfaceArea:c2(M.area),
          boundingBox:{min:M.mn.map(c),max:M.mx.map(c),
                       size:[0,1,2].map(i=>c(M.mx[i]-M.mn[i]))}},
    principalAxis:A.up,
    coverage:(()=>{
      const seen=new Set();
      for(const f of A.feats) for(const x of f.faces) seen.add(x);
      for(const p of A.planes) for(const x of p.faces) seen.add(x);
      let a=0; for(const x of seen) a+=M.fa[x];
      return {note:"share of surface area explained by a fitted primitive; the rest is freeform, blends, or below the area threshold. Anything not covered has no parametric handle.",
              explained:+(a/M.area).toFixed(3),
              curvedFeatures:A.feats.length, planarFaces:A.planes.length};
    })(),
    features:A.feats.map(f=>{
      const base={id:featureId(f),kind:f.kind,internal:!!f.hole,
                  surfaceArea:c2(f.area),fitRms:+c(f.rms).toFixed(6)};
      if(f.kind==="cyl") return {...base,type:"cylinder",diameter:c(f.radius*2),length:c(f.len),
        through:!!f.through,axis:f.axis.map(v=>+v.toFixed(6)),start:f.p0.map(c),end:f.p1.map(c)};
      if(f.kind==="sph") return {...base,type:"sphere",radius:c(f.radius),centre:f.c.map(c)};
      return {...base,type:"cone",includedAngle:+(2*f.half*180/Math.PI).toFixed(4),
        diameterStart:c(2*f.r0),diameterEnd:c(2*f.r1),length:c(f.len),
        axis:f.axis.map(v=>+v.toFixed(6)),apex:f.apex.map(c)};
    }),
    planarFaces:A.planes.map((pl,i)=>{
      const e=planeExtent(M,pl);
      const up=A.up, dot=Math.abs(pl.n[0]*up[0]+pl.n[1]*up[1]+pl.n[2]*up[2]);
      const deg=Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI;
      return {id:"face_"+(i+1),
        plane:{normal:pl.n.map(v=>+v.toFixed(6)),offset:c(pl.d),
               note:"points p on the face satisfy dot(p, normal) == offset; normal points out of the material"},
        degreesFromBase:+deg.toFixed(3),
        surfaceArea:c2(pl.area), centroid:e.centroid.map(c),
        extent:{note:"how far the face actually reaches, so a cutter can be bounded to it",
                inPlaneAxisU:e.u.map(v=>+v.toFixed(6)), inPlaneAxisV:e.v.map(v=>+v.toFixed(6)),
                uMin:c(e.u0),uMax:c(e.u1),vMin:c(e.v0),vMax:c(e.v1)}};
    }),
    inclinedFaces:A.angles.map((a,i)=>({id:"incl_"+(i+1),
      degreesFromBase:+a.deg.toFixed(4),degreesFromAxis:+(90-a.deg).toFixed(4),
      plane:{normal:a.n.map(v=>+v.toFixed(6)),offset:c(a.d),
             note:"points p on the plane satisfy dot(p, normal) == offset"},
      surfaceArea:c2(a.area),coplanarPatches:a.parts,centroid:a.centroid.map(c)})),
    stepChains:A.steps.map(st=>({axis:st.axis,
      levelsFromDatum:st.levels.map(t=>c(t-M.mn[st.ai])),
      stepSizes:st.segs.map(sg=>c(sg.len))})),
    relationships:relationships(M,A),
    passages:xs?{
      note:"Air enclosed by material, followed slice to slice. A channel is one continuous passage; narrowestArea is its tightest section, which is what limits flow or what has to fit through. openAtStart/openAtEnd say whether it reaches the end faces of the part.",
      axis:xs.axis, sliceStep:c(xs.step), resolution:c(xs.resolution),
      channels:chans.map(C=>({id:"passage_"+C.id,
        fromDatum:c(C.from-M.mn[xs.ai]), toDatum:c(C.to-M.mn[xs.ai]), length:c(C.length),
        narrowestArea:c2(C.min), narrowestAtDatum:c(C.minAt-M.mn[xs.ai]),
        widestArea:c2(C.max),
        openAtStart:!!C.startsAtEnd, openAtEnd:!!C.endsAtEnd,
        connectsTo:(C.joins||[]).map(x=>"passage_"+x),
        blind:!C.startsAtEnd&&!C.endsAtEnd&&!(C.joins||[]).length}))
    }:null,
    sectionProfile:xs?{
      note:"solid cross-section and enclosed passage areas at each level, along "+xs.axis,
      slices:xs.slices.map(s=>({at:c(s.t-M.mn[xs.ai]),solidArea:c2(s.solid),
        passageAreas:s.passages.filter(p=>p.area>=biggest*0.005).map(p=>c2(p.area))}))
    }:null
  },null,2);
}

/* ---------- OpenSCAD: an editable rebuild scaffold ----------
   Reconstructing a watertight solid from a mesh is unreliable, so the mesh
   stays as the base and every fitted feature is handed over as exact,
   positioned geometry you can add or subtract. Change a number, re-render. */
function toSCAD(M,A,S,xs){
  const c=v=>+(v/S.k).toFixed(5);
  const V=a=>"["+a.map(v=>+(+v).toFixed(6)).join(", ")+"]";
  const P=a=>"["+a.map(c).join(", ")+"]";
  const L=[];
  const p=s=>L.push(s);
  p("// =====================================================================");
  p("// "+(S.name||"part")+"  \u2014 parametric edit scaffold");
  p("// Generated by STL Blueprint. Units: "+S.u+".");
  p("//");
  p("// The mesh is the base solid. Every dimension below was fitted to it by");
  p("// least squares, so these are the design values, not facet measurements.");
  p("// Edit a parameter, then:   openscad -o out.stl "+(S.name||"part").replace(/\.stl$/i,"")+".scad");
  p("// =====================================================================");
  p("");
  p('base_stl = "'+(S.name||"part.stl")+'";   // keep this file beside the .scad');
  p("$fn = 96;");
  p("eps = 0.01;                 // overshoot so coincident faces cut cleanly");
  p("");
  p("// ---- overall ---------------------------------------------------------");
  p("bbox_size   = "+P([M.mx[0]-M.mn[0],M.mx[1]-M.mn[1],M.mx[2]-M.mn[2]])+";");
  p("bbox_min    = "+P(M.mn)+";");
  p("part_axis   = "+V(A.up)+";");
  p("");
  p("// ---- fitted features -------------------------------------------------");
  for(const f of A.feats){
    const n=featureId(f);
    p("// "+(f.kind==="cyl"?(f.hole?"internal bore":"external cylinder"):
              f.kind==="sph"?(f.hole?"internal spherical cavity":"external spherical dome"):"taper")
      +"   fit rms "+c(f.rms)+" "+S.u);
    if(f.kind==="cyl"){
      p(n+"_d    = "+c(f.radius*2)+";");
      p(n+"_len  = "+c(f.len)+";");
      p(n+"_p0   = "+P(f.p0)+";");
      p(n+"_axis = "+V(f.axis)+";");
    } else if(f.kind==="sph"){
      p(n+"_r      = "+c(f.radius)+";");
      p(n+"_centre = "+P(f.c)+";");
    } else {
      p(n+"_angle = "+ +(2*f.half*180/Math.PI).toFixed(4)+";   // included");
      p(n+"_apex  = "+P(f.apex)+";");
      p(n+"_axis  = "+V(f.axis)+";");
      p(n+"_t0    = "+c(f.tmin)+";  "+n+"_t1 = "+c(f.tmax)+";");
    }
    p("");
  }
  p("// ---- flat faces ------------------------------------------------------");
  p("// normal points OUT of the material; the face lies on dot(p, normal) == offset.");
  p("// u/v span the face, so a cutter can be bounded to the face instead of");
  p("// slicing the whole part in half.");
  p("");
  A.planes.forEach((pl,i)=>{
    const e=planeExtent(M,pl);
    const up=A.up, dt=Math.abs(pl.n[0]*up[0]+pl.n[1]*up[1]+pl.n[2]*up[2]);
    const deg=Math.acos(Math.max(-1,Math.min(1,dt)))*180/Math.PI;
    const n="face"+(i+1);
    p("// "+deg.toFixed(2)+"\u00b0 from the base plane, area "+ +c(pl.area/S.k).toFixed(0)+" "+S.u+"\u00b2");
    p(n+" = [ "+V(pl.n)+", "+c(pl.d)+", "+P(e.centroid)+", "+V(e.u)+", "+V(e.v)+", "+
      "["+[e.u0,e.u1,e.v0,e.v1].map(c).join(", ")+"] ];");
  });
  p("");
  if(xs){
    let big=0;
    for(const s of xs.slices) for(const q of s.passages) if(q.area>big) big=q.area;
    const cs=xs.channels.filter(C=>C.length>=xs.step*3&&C.max>=big*0.02);
    const tight=cs.length?cs.reduce((a,b)=>a.min<b.min?a:b):null;
    if(tight){
      p("// ---- measured -------------------------------------------------------");
      p("// Tightest section of a through passage: "+ +(tight.min/(S.k*S.k)).toFixed(1)+" "+S.u+"\u00b2 at "+
        c(tight.minAt-M.mn[xs.ai])+" "+S.u+" from the datum along "+xs.axis+".");
      p("// That is the limiting section for anything that has to flow or fit through.");
      p("");
    }
  }
  p("// ---- helpers ---------------------------------------------------------");
  p("function _axv(n) = (abs(n[2]) > 0.999999) ? [1, 0, 0] : cross([0, 0, 1], n);");
  p("function _ang(n) = acos(max(-1, min(1, n[2])));");
  p("module orient(n) { rotate(a = _ang(n), v = _axv(n)) children(); }");
  p("");
  p("module base() { import(base_stl, convexity = 10); }");
  p("");
  p("// solid filling the half-space dot(p, n) >= d  \u2014 use it to extend a cut");
  p("module halfspace(n, d, s = 1000) {");
  p("  translate([n[0]*d, n[1]*d, n[2]*d]) orient(n)");
  p("    translate([0, 0, s/2]) cube([s, s, s], center = true);");
  p("}");
  p("");
  p("module feat_cylinder(p0, axis, d, len, over = 0) {");
  p("  translate(p0) orient(axis) translate([0, 0, -over]) cylinder(h = len + 2*over, d = d);");
  p("}");
  p("");
  p("module feat_sphere(centre, r) { translate(centre) sphere(r = r); }");
  p("");
  p("// Cut `depth` of material away from one flat face, bounded to that face.");
  p("// This is the safe way to deepen a pocket or open a slot further: a bare");
  p("// halfspace() is unbounded and will take half the part with it.");
  p("module shave(face, depth, margin = 0.5) {");
  p("  n = face[0]; c = face[2]; u = face[3]; v = face[4]; ext = face[5];");
  p("  du = ext[1] - ext[0] + 2*margin;  dv = ext[3] - ext[2] + 2*margin;");
  p("  cu = (ext[0] + ext[1])/2;         cv = (ext[2] + ext[3])/2;");
  p("  o  = c + u*cu + v*cv;");
  p("  multmatrix([[u[0], v[0], n[0], o[0]],");
  p("              [u[1], v[1], n[1], o[1]],");
  p("              [u[2], v[2], n[2], o[2]],");
  p("              [0, 0, 0, 1]])");
  p("    translate([0, 0, -depth/2 + eps]) cube([du, dv, depth + 2*eps], center = true);");
  p("}");
  p("");
  p("module feat_cone(apex, axis, incl, t0, t1) {");
  p("  r0 = abs(t0) * tan(incl/2);  r1 = abs(t1) * tan(incl/2);");
  p("  translate(apex) orient(axis) translate([0, 0, t0]) cylinder(h = t1 - t0, r1 = r0, r2 = r1);");
  p("}");
  p("");
  p("// ---- the part --------------------------------------------------------");
  p("// Subtract to remove material, union to add. Some worked starting points:");
  const bore=A.feats.find(f=>f.kind==="cyl"&&f.hole);
  if(bore){
    const n=featureId(bore);
    p("//");
    p("//   open the bore out by 2 "+S.u+":");
    p("//     difference() { base();");
    p("//       feat_cylinder("+n+"_p0, "+n+"_axis, "+n+"_d + 2, "+n+"_len, eps); }");
  }
  if(A.planes.length){
    p("//");
    p("//   take 3 "+S.u+" off a flat face (deepens a pocket, lengthens a slot):");
    p("//     difference() { base(); shave(face1, 3); }");
  }
  p("//");
  p("difference() {");
  p("  base();");
  p("  // your cuts here");
  p("}");
  p("");
  return L.join("\n");
}
/* ============================================================
   App
   ============================================================ */
const $=s=>document.querySelector(s);
let MESH=null, A=null, NAME="", HI=null, HISTEP=null, FOURTH="section", TOPV="top", ELEV="front";

function state(){
  const src=+$("#srcUnit").value, dsp=+$("#dspUnit").value;
  const k=dsp/src, u=$("#dspUnit").selectedOptions[0].text;
  const dec=u==="in"?4:2;
  return {k,u,name:NAME,hi:HI,hiStep:HISTEP,steps:A?A.steps:[],fourth:FOURTH,top:TOPV,elev:ELEV,
    fmt:v=>(v/k).toFixed(dec),
    fmt3:v=>v>=1000?(v/1000).toFixed(2)+"k":v.toFixed(1)};
}
function dl(name,data,mime){
  const a=document.createElement("a");
  a.download=name; a.href=URL.createObjectURL(new Blob([data],{type:mime}));
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),5000);
}
function syncFourthLabel(){
  // the 4th pane always shows the elevation you are NOT already looking at
  $("#otherOpt").textContent=ELEV==="right"?"Front view":"Right view";
}
function status(msg,busy){
  const el=$("#status");
  el.textContent=msg||"";
  el.className="status"+(busy?" busy":"");
}
let BG=null, DRAG=null, RAF=0;
export function draw(){
  if(!MESH||!A) return;
  const cv=$("#sheet");
  if(SINGLE_VIEW===null) drawSheet(cv,MESH,A,state());
  else drawSheetSingle(cv,MESH,A,state(),SINGLE_VIEW);
  if(!BG) BG=document.createElement("canvas");
  if(BG.width!==cv.width||BG.height!==cv.height){ BG.width=cv.width; BG.height=cv.height; }
  const bg=BG.getContext("2d");
  bg.setTransform(1,0,0,1,0,0); bg.clearRect(0,0,BG.width,BG.height); bg.drawImage(cv,0,0);
}
export function dimensionsVisible(){ return DIMS_ON; }
// called from the host app's "hide dimensions" toggle
export function toggleDimensions(){
  DIMS_ON=!DIMS_ON;
  if(!DIMS_ON) HOVERDIM=null;
  draw();
  return DIMS_ON;
}
// called from the host app to switch between the full 4-up sheet (null) and
// a single pane shown full-size (0=plan,1=iso,2=elevation,3=section/4th)
export function setSingleView(idx){
  SINGLE_VIEW=idx;
  draw();
}
/* Repaint only the ISO pane: blit the cached sheet, then redraw that one view.
   A full sheet is far too slow to run on every pointermove. */
function drawIso(quick){
  const cv=$("#sheet"), P=SHEETINFO.pane;
  if(!BG||!P||!MESH||!A){ draw(); return; }
  const g=cv.getContext("2d"), dpr=cv.width/(cv.clientWidth||1);
  g.save(); g.setTransform(1,0,0,1,0,0); g.drawImage(BG,0,0); g.restore();
  g.save(); g.setTransform(dpr,0,0,dpr,0,0);
  g.beginPath(); g.rect(P.x,P.y,P.w,P.h); g.clip();
  g.fillStyle=SHEET; g.fillRect(P.x,P.y,P.w,P.h);
  drawView(g,P,isoView(ISO.az,ISO.el),MESH,A,SHEETINFO.scale,SHEETINFO.ctr,state(),quick);
  g.restore();
  if(!SHEETINFO.single){
    // the fill above paints over its half of the shared grid lines - put them back
    g.save(); g.setTransform(dpr,0,0,dpr,0,0);
    g.strokeStyle=GRID; g.lineWidth=.6;
    g.beginPath();
    g.moveTo(SHEETINFO.gridX,P.y); g.lineTo(SHEETINFO.gridX,P.y+P.h);
    g.moveTo(P.x,SHEETINFO.gridY); g.lineTo(P.x+P.w,SHEETINFO.gridY);
    g.stroke();
    g.restore();
  }
}
function inIso(cv,e){
  const P=SHEETINFO.pane; if(!P) return false;
  const r=cv.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top;
  return x>=P.x&&x<=P.x+P.w&&y>=P.y&&y<=P.y+P.h;
}

function featLabel(f,S){
  if(f.kind==="cyl")  return (f.hole?"Bore":"Cylinder")+"  \u00D8"+S.fmt(f.radius*2);
  if(f.kind==="sph")  return (f.hole?"Cavity":"Dome")+"  SR"+S.fmt(f.radius);
  if(f.kind==="cone") return "Taper  "+(2*f.half*180/Math.PI).toFixed(1)+"\u00B0";
  return "Feature";
}
function renderTables(){
  const S=state();
  // features
  if(!A.feats.length){
    $("#featBody").innerHTML='<div class="empty">No round or spherical features found. This part is all flat faces \u2014 the step chains below carry the measurements.</div>';
    $("#featCount").textContent="";
  } else {
    let h='<table><thead><tr><th>Feature</th><th class="n">Size</th><th class="n">Along</th><th>Note</th></tr></thead><tbody>';
    A.feats.forEach((f,i)=>{
      let size="",note="";
      if(f.kind==="cyl"){ size="\u00D8"+S.fmt(f.radius*2); note=f.through?"through":(f.hole?"blind":"boss"); }
      if(f.kind==="sph"){ size="SR"+S.fmt(f.radius); note=f.hole?"internal":"external"; }
      if(f.kind==="cone"){ size="\u00D8"+S.fmt(2*Math.min(f.r0,f.r1))+"\u2013"+S.fmt(2*Math.max(f.r0,f.r1));
                           note=(2*f.half*180/Math.PI).toFixed(1)+"\u00B0 incl"; }
      h+=`<tr data-i="${i}" class="${f===HI?'sel':''}">
        <td>${featLabel(f,S)}</td><td class="n">${size}</td>
        <td class="n">${S.fmt(f.len)}</td><td class="dim">${note}</td></tr>`;
    });
    $("#featBody").innerHTML=h+"</tbody></table>";
    $("#featCount").textContent=A.feats.length+" found";
    $("#featBody").querySelectorAll("tr[data-i]").forEach(tr=>{
      tr.onclick=()=>{ const f=A.feats[+tr.dataset.i]; HI=(HI===f?null:f); HISTEP=null; renderTables(); draw(); };
    });
  }

  // angles
  if(!A.angles.length){
    $("#angBody").innerHTML='<div class="empty">No inclined faces \u2014 every flat face on this part is square to an axis.</div>';
  } else {
    let h='<table><thead><tr><th>Inclined face</th><th class="n">From base</th><th class="n">From axis</th></tr></thead><tbody>';
    A.angles.forEach((a,i)=>{
      h+=`<tr data-a="${i}" class="${a===HI?'sel':''}"><td>${a.parts>1?a.parts+" faces":"1 face"}</td>
      <td class="n">${a.deg.toFixed(2)}\u00B0</td><td class="n">${(90-a.deg).toFixed(2)}\u00B0</td></tr>`;
    });
    $("#angBody").innerHTML=h+"</tbody></table>";
    $("#angBody").querySelectorAll("tr[data-a]").forEach(tr=>{
      tr.onclick=()=>{ const a=A.angles[+tr.dataset.a]; HI=(HI===a?null:a); HISTEP=null; renderTables(); draw(); };
    });
  }

  // steps
  document.getElementById("stepsCard")?.classList.toggle("is-empty",!A.steps.length);
  if(!A.steps.length){
    $("#stepBody").innerHTML='<div class="empty">Nothing between the outer faces to measure against \u2014 the overall extents are the whole story.</div>';
    $("#stepCount").textContent="";
  } else {
    let n=0;
    let h='<table><thead><tr><th>Axis</th><th class="n">From</th><th class="n">To</th><th class="n">Size</th></tr></thead><tbody>';
    A.steps.forEach((st,si)=>st.segs.forEach((sg,gi)=>{
      n++;
      h+=`<tr data-s="${si}" data-g="${gi}" class="${sg===HISTEP?'sel':''}">
        <td>${st.axis}</td><td class="n">${S.fmt(sg.a-MESH.mn[st.ai])}</td>
        <td class="n">${S.fmt(sg.b-MESH.mn[st.ai])}</td><td class="n">${S.fmt(sg.len)}</td></tr>`;
    }));
    $("#stepBody").innerHTML=h+"</tbody></table>";
    $("#stepCount").textContent=n+" measured";
    $("#stepBody").querySelectorAll("tr[data-s]").forEach(tr=>{
      tr.onclick=()=>{
        const sg=A.steps[+tr.dataset.s].segs[+tr.dataset.g];
        HISTEP=(HISTEP===sg?null:sg); HI=null; renderTables(); draw();
      };
    });
  }

  const M=MESH, ext=[0,1,2].map(i=>S.fmt(M.mx[i]-M.mn[i]));
  $("#partBody").innerHTML=[
    ["Bounding box",ext.join(" \u00D7 ")+" "+S.u],
    ["Volume",S.fmt3(M.volume/Math.pow(S.k,3))+" "+S.u+"\u00B3"],
    ["Surface area",S.fmt3(M.area/Math.pow(S.k,2))+" "+S.u+"\u00B2"],
    ["Diagonal",S.fmt(M.diag)+" "+S.u],
    ["Triangles",M.nf.toLocaleString()],
    ["Mesh",M.watertight?"closed":M.openEdges+" free edges"],
  ].map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join("");

  const statusBar=document.getElementById("statusBarBody");
  if(statusBar) statusBar.innerHTML=[
    ["Part",S.name||"—"],
    ["Bounding box",ext.join(" × ")+" "+S.u],
    ["Volume",S.fmt3(M.volume/Math.pow(S.k,3))+" "+S.u+"³"],
    ["Triangles",M.nf.toLocaleString()],
    ["Mesh",M.watertight?"closed":M.openEdges+" free edges"],
  ].map(([k,v])=>`<span class="stat"><b>${k}</b>${v}</span>`).join("");
}

async function loadSample(){
  status("building sample\u2026",true);
  try{
    const bin=Uint8Array.from(atob(SAMPLE_B64),c=>c.charCodeAt(0));
    let buf;
    if(typeof DecompressionStream==="function"){
      const ds=new DecompressionStream("gzip");
      buf=await new Response(new Blob([bin]).stream().pipeThrough(ds)).arrayBuffer();
    } else throw new Error("no gzip support");
    const dv=new DataView(buf);
    const nv=dv.getUint32(0,true), nf=dv.getUint32(4,true);
    const verts=new Float32Array(buf,8,nv*3);
    const idx=new Uint16Array(buf,8+nv*12,nf*3);
    const tris=new Float64Array(nf*9);
    for(let i=0;i<nf*3;i++){
      tris[i*3]=verts[idx[i]*3]; tris[i*3+1]=verts[idx[i]*3+1]; tris[i*3+2]=verts[idx[i]*3+2];
    }
    load(tris,"test.stl");
  }catch(e){
    status("sample unavailable in this browser \u2014 open an STL instead");
  }
}

function load(tris,name){
  status("analysing\u2026",true);
  setTimeout(()=>{
    try{
      MESH=buildMesh(tris);
      if(!MESH||!MESH.nf){ status("no triangles in that file"); return; }
      NAME=name; HI=null; HISTEP=null;
      const fn=document.getElementById("fileName"); if(fn) fn.textContent=name;
      const t0=performance.now();
      A=analyse(MESH);
      FOURTH=A.feats.some(f=>f.hole)?"section":"other";
      $("#fourthSel").value=FOURTH; syncFourthLabel();
      $("#panel").hidden=false; $("#drop").hidden=true;
      renderTables(); draw();
      status(`${MESH.nf.toLocaleString()} triangles \u00b7 analysed in ${Math.round(performance.now()-t0)} ms`);
    }catch(e){ status("could not read that file: "+e.message); }
  },20);
}

function openFile(file){
  const r=new FileReader();
  r.onload=()=>{
    try{ load(parseSTL(r.result),file.name); }
    catch(e){ status("could not read that file: "+e.message); }
  };
  r.readAsArrayBuffer(file);
}

export function initApp(){

  $("#file").onchange=e=>{ if(e.target.files[0]) openFile(e.target.files[0]); };
  $("#sample").onclick=loadSample;
  $("#srcUnit").onchange=()=>{ if(A){renderTables();draw();} };
  $("#dspUnit").onchange=()=>{ if(A){renderTables();draw();} };
  $("#topSel").onchange=e=>{ TOPV=e.target.value; draw(); };
  $("#elevSel").onchange=e=>{ ELEV=e.target.value; syncFourthLabel(); draw(); };
  $("#fourthSel").onchange=e=>{ FOURTH=e.target.value; draw(); };
  $("#exportSel").onchange=ev=>{
    const kind=ev.target.value; ev.target.value="";
    if(!kind||!MESH||!A) return;
    const base=(NAME||"part").replace(/\.stl$/i,""), S=state();
    const w=$("#sheet").clientWidth||1180;
    status("writing "+kind.toUpperCase()+"\u2026",true);
    setTimeout(()=>{
      try{
        if(kind==="png"){
          const a=document.createElement("a");
          a.download=base+"-blueprint.png"; a.href=$("#sheet").toDataURL("image/png"); a.click();
        }
        else if(kind==="svg") dl(base+"-blueprint.svg",toSVG(MESH,A,S,w,false),"image/svg+xml");
        else if(kind==="dxf") dl(base+"-blueprint.dxf",dxfBytes(toDXF(MESH,A,S,w)),"application/dxf");
        else if(kind==="csv") dl(base+"-measurements.csv",toCSV(MESH,A,S),"text/csv");
        else if(kind==="json"||kind==="scad"){
          const ax=A.up.indexOf(1);
          if(!A.xs) A.xs=crossSections(MESH,ax<0?2:ax);
          if(kind==="json") dl(base+"-model.json",toModelJSON(MESH,A,S,A.xs),"application/json");
          else dl(base+".scad",toSCAD(MESH,A,S,A.xs),"text/plain");
        }
        status(kind.toUpperCase()+" written");
      }catch(err){ status("export failed: "+err.message); }
    },30);
  };
  const dz=document.body;
  dz.addEventListener("dragover",e=>{e.preventDefault();$("#drop").classList.add("over");});
  dz.addEventListener("dragleave",()=>$("#drop").classList.remove("over"));
  dz.addEventListener("drop",e=>{
    e.preventDefault(); $("#drop").classList.remove("over");
    if(e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
  });
  const cv=$("#sheet");
  cv.addEventListener("pointerdown",e=>{
    if(!inIso(cv,e)) return;
    DRAG={x:e.clientX,y:e.clientY};
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor="grabbing";
    e.preventDefault();
  });
  cv.addEventListener("pointermove",e=>{
    if(!DRAG){
      if(inIso(cv,e)){
        cv.style.cursor="grab";
        if(HOVERDIM){ HOVERDIM=null; draw(); }
        return;
      }
      if(DIMS_ON&&MESH&&A){
        const r=cv.getBoundingClientRect();
        const hit=hitTestDim(e.clientX-r.left,e.clientY-r.top);
        cv.style.cursor=hit?"pointer":"default";
        if(hit!==HOVERDIM){ HOVERDIM=hit; if(!RAF) RAF=requestAnimationFrame(()=>{ RAF=0; draw(); }); }
      } else {
        cv.style.cursor="default";
      }
      return;
    }
    ISO.az-=(e.clientX-DRAG.x)*0.011;
    ISO.el=Math.max(-1.45,Math.min(1.45,ISO.el+(e.clientY-DRAG.y)*0.011));
    DRAG={x:e.clientX,y:e.clientY};
    // outlines cost only a few percent here, so keep them unless the mesh is huge
    if(!RAF) RAF=requestAnimationFrame(()=>{ RAF=0; drawIso(MESH.nf>40000); });
  });
  cv.addEventListener("pointerleave",()=>{
    if(HOVERDIM){ HOVERDIM=null; draw(); }
  });
  const stop=e=>{
    if(!DRAG) return;
    DRAG=null; cv.style.cursor=inIso(cv,e)?"grab":"default";
    if(RAF){ cancelAnimationFrame(RAF); RAF=0; }
    drawIso(false);
  };
  cv.addEventListener("pointerup",stop);
  cv.addEventListener("pointercancel",stop);
  cv.addEventListener("dblclick",e=>{
    if(!inIso(cv,e)) return;
    ISO.az=ISO_HOME.az; ISO.el=ISO_HOME.el; drawIso(false);
  });
  let t; addEventListener("resize",()=>{clearTimeout(t);t=setTimeout(draw,140);});
  loadSample();


  document.getElementById("note").innerHTML=
   "Every dimension is fitted to the mesh, not read off the bounding box: cylinders, spheres and cones "+
   "are recovered by least squares, so a 72-facet cylinder reports its true diameter rather than the "+
   "flat-to-flat distance. Flat faces are found separately and used for the step chains and the angle "+
   "callouts. <b>Section A-A</b> cuts through the middle so bores and cavities can be dimensioned "+
   "directly, and it follows whichever elevation you pick. The <b>plan</b> and <b>elevation</b> pickers "+
   "swap those panes for the bottom and right views; the 4th pane always shows the elevation you are not "+
   "already looking at. Swapping panes drops the third-angle symbol from the title block, since the "+
   "arrangement is no longer standard. The <b>ISO</b> pane is live: "+
   "drag inside it to orbit, double-click to reset. It stays a true axonometric projection at the "+
   "sheet scale, so it never turns into a perspective render. Click any table row to highlight that "+
   "measurement on the sheet.<br><br>"+
   "<b>Exports.</b> <b>DXF R12</b> is the interchange format every CAD package reads; it is written at "+
   "<b>1:1 in model units</b>, on layers (OUTLINE, HIDDEN, CENTRE, SECTION, HATCH, DIMS, TEXT, FITTED, "+
   "PICTORIAL), so measuring a line in CAD returns the real size. The FITTED layer carries true CIRCLE "+
   "entities at the exact fitted diameters rather than the mesh's faceted silhouette. <b>SVG</b> is the "+
   "same drawing as vector line art for documents and vector editors. <b>CSV</b> and <b>JSON</b> carry "+
   "the measurements themselves.<br><br>"+
   "<b>For an AI to work on.</b> A drawing is for reading, not editing. <b>JSON</b> is the semantic "+
   "model: every feature with its type, exact parameters and fit residual, how features relate "+
   "(coaxial gaps are wall thicknesses, tangency means the surface is smooth across a join), and a "+
   "<b>passage map</b> \u2014 the part sliced along its axis so the enclosed voids are followed as "+
   "channels, each with its narrowest section. That last part is what turns \u201chere are the sizes\u201d "+
   "into \u201chere is where it is tight\u201d. <b>OpenSCAD</b> is the editable half: the mesh stays as "+
   "the base solid and every fitted feature is handed over as positioned geometry, so changing one "+
   "number and re-rendering gives a new STL. Faces come with their in-plane extents and a "+
   "<code>shave()</code> helper, because an unbounded plane will happily cut the part in half. "+
   "Because a vector file has no paint order to hide things behind, the "+
   "outlines in SVG and DXF are recomputed with real hidden-line removal rather than reusing what is "+
   "on screen. <b>PNG</b> is the pixel-exact sheet including the shaded, rotated ISO view.";

}
