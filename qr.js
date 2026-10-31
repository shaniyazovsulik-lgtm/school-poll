(function(g){
var T=[null,[26,10,1],[44,16,1],[70,26,1],[100,18,2],[134,24,2],[172,16,4],[196,18,4],[242,22,4],[292,22,5],[346,26,5]];
var AL=[null,[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
var EXP=[],LOG=[];(function(){var x=1,i;for(i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&256)x^=0x11d}for(i=255;i<512;i++)EXP[i]=EXP[i-255]})();
function mul(a,b){return a&&b?EXP[LOG[a]+LOG[b]]:0}
function rs(data,n){var gen=[1],i,j;for(i=0;i<n;i++){var ng=new Array(gen.length+1).fill(0);for(j=0;j<gen.length;j++){ng[j]^=gen[j];ng[j+1]^=mul(gen[j],EXP[i])}gen=ng}
 var r=new Array(n).fill(0);data.forEach(function(b){var f=b^r[0];r.shift();r.push(0);for(var k=0;k<n;k++)r[k]^=mul(gen[k+1],f)});return r}
function encode(text){var s=unescape(encodeURIComponent(text)),bytes=[],i,j,v;for(i=0;i<s.length;i++)bytes.push(s.charCodeAt(i));
 for(v=1;v<=10;v++){var t0=T[v],d0=t0[0]-t0[1]*t0[2];if(4+(v<10?8:16)+8*bytes.length<=d0*8)break}
 if(v>10)throw new Error("Ссылка слишком длинная для QR");
 var t=T[v],dc=t[0]-t[1]*t[2],bits=[];function put(val,n){for(var k=n-1;k>=0;k--)bits.push((val>>k)&1)}
 put(4,4);put(bytes.length,v<10?8:16);bytes.forEach(function(x){put(x,8)});
 var cap=dc*8;put(0,Math.min(4,cap-bits.length));while(bits.length%8)bits.push(0);
 var pad=[0xEC,0x11],k2=0;while(bits.length<cap)put(pad[k2++%2],8);
 var cw=[];for(i=0;i<bits.length;i+=8){var x=0;for(j=0;j<8;j++)x=x<<1|bits[i+j];cw.push(x)}
 var nb=t[2],sh=Math.floor(dc/nb),lg=dc%nb,blocks=[],ecs=[],pos=0;
 for(i=0;i<nb;i++){var len=sh+(i>=nb-lg?1:0),d=cw.slice(pos,pos+len);pos+=len;blocks.push(d);ecs.push(rs(d,t[1]))}
 var out=[];for(i=0;i<sh+1;i++)blocks.forEach(function(d){if(i<d.length)out.push(d[i])});
 for(i=0;i<t[1];i++)ecs.forEach(function(e){out.push(e[i])});
 return{v:v,cw:out}}
function make(text){
 var e=encode(text),v=e.v,n=17+4*v,M=[],F=[],i,j;
 for(i=0;i<n;i++){M.push(new Array(n).fill(false));F.push(new Array(n).fill(false))}
 function set(r,c,val){if(r>=0&&r<n&&c>=0&&c<n){M[r][c]=val;F[r][c]=true}}
 [[0,0],[0,n-7],[n-7,0]].forEach(function(p){for(var dr=-1;dr<=7;dr++)for(var dc=-1;dc<=7;dc++){var d=Math.max(Math.abs(dr-3),Math.abs(dc-3));set(p[0]+dr,p[1]+dc,d!==2&&d!==4)}});
 for(i=0;i<n;i++){if(!F[6][i])set(6,i,i%2===0);if(!F[i][6])set(i,6,i%2===0)}
 var al=AL[v];al.forEach(function(a,ia){al.forEach(function(b,ib){if((ia===0&&ib===0)||(ia===0&&ib===al.length-1)||(ia===al.length-1&&ib===0))return;
  for(var dr=-2;dr<=2;dr++)for(var dc=-2;dc<=2;dc++)set(a+dr,b+dc,Math.max(Math.abs(dr),Math.abs(dc))!==1)})});
 function fmt(mask){var data=mask,rem=data,k;for(k=0;k<10;k++)rem=(rem<<1)^((rem>>9)*0x537);var b=((data<<10)|rem)^0x5412;
  function bit(q){return((b>>q)&1)!==0}
  for(k=0;k<=5;k++)set(k,8,bit(k));set(7,8,bit(6));set(8,8,bit(7));set(8,7,bit(8));for(k=9;k<15;k++)set(8,14-k,bit(k));
  for(k=0;k<8;k++)set(8,n-1-k,bit(k));for(k=8;k<15;k++)set(n-15+k,8,bit(k));set(n-8,8,true)}
 fmt(0);
 if(v>=7){var rem=v,k;for(k=0;k<12;k++)rem=(rem<<1)^((rem>>11)*0x1F25);var vb=(v<<12)|rem;
  for(k=0;k<18;k++){var b=((vb>>k)&1)!==0,a=n-11+k%3,c=Math.floor(k/3);set(a,c,b);set(c,a,b)}}
 var bi=0,total=e.cw.length*8;
 for(var right=n-1;right>=1;right-=2){if(right===6)right=5;
  for(var vert=0;vert<n;vert++)for(j=0;j<2;j++){var x=right-j,up=((right+1)&2)===0,y=up?n-1-vert:vert;
   if(!F[y][x]&&bi<total){M[y][x]=((e.cw[bi>>3]>>(7-(bi&7)))&1)!==0;bi++}}}
 function mk(m,x,y){switch(m){case 0:return(x+y)%2===0;case 1:return y%2===0;case 2:return x%3===0;case 3:return(x+y)%3===0;
  case 4:return(Math.floor(x/3)+Math.floor(y/2))%2===0;case 5:return x*y%2+x*y%3===0;case 6:return(x*y%2+x*y%3)%2===0;default:return((x+y)%2+x*y%3)%2===0}}
 function apply(m){for(var y=0;y<n;y++)for(var x=0;x<n;x++)if(!F[y][x]&&mk(m,x,y))M[y][x]=!M[y][x]}
 function pen(){var p=0,y,x,run,line,L=[];
  function lines(){var a=[];for(var y=0;y<n;y++)a.push(M[y].slice());for(var x=0;x<n;x++){var c=[];for(var y2=0;y2<n;y2++)c.push(M[y2][x]);a.push(c)}return a}
  lines().forEach(function(l){run=1;for(var i=1;i<=n;i++){if(i<n&&l[i]===l[i-1])run++;else{if(run>=5)p+=run-2;run=1}}
   var s=l.map(function(b){return b?1:0}).join("");var pa="10111010000",pb="00001011101",q=-1;
   while((q=s.indexOf(pa,q+1))>=0)p+=40;q=-1;while((q=s.indexOf(pb,q+1))>=0)p+=40});
  for(y=0;y<n-1;y++)for(x=0;x<n-1;x++){var c=M[y][x];if(c===M[y][x+1]&&c===M[y+1][x]&&c===M[y+1][x+1])p+=3}
  var dark=0;for(y=0;y<n;y++)for(x=0;x<n;x++)if(M[y][x])dark++;p+=Math.floor(Math.abs(dark*20-n*n*10)/(n*n))*10;return p}
 var best=0,bp=1e9;for(var m=0;m<8;m++){apply(m);fmt(m);var pp=pen();if(pp<bp){bp=pp;best=m}apply(m)}
 apply(best);fmt(best);return M}
function svg(text,scale,dark,light){var M=make(text),n=M.length,s=scale||6,q=4,sz=(n+2*q)*s,d="";
 for(var y=0;y<n;y++)for(var x=0;x<n;x++)if(M[y][x])d+="M"+((x+q)*s)+" "+((y+q)*s)+"h"+s+"v"+s+"h-"+s+"z";
 return'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+sz+" "+sz+'" width="'+sz+'" height="'+sz+'" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="'+(light||"#fff")+'"/><path d="'+d+'" fill="'+(dark||"#000")+'"/></svg>'}
function canvas(text,scale){var M=make(text),n=M.length,s=scale||8,q=4,c=document.createElement("canvas");c.width=c.height=(n+2*q)*s;var x=c.getContext("2d");
 x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);x.fillStyle="#000";for(var j=0;j<n;j++)for(var i=0;i<n;i++)if(M[j][i])x.fillRect((i+q)*s,(j+q)*s,s,s);return c}
g.QR={matrix:make,svg:svg,canvas:canvas};
if(typeof module!=="undefined")module.exports=g.QR;
})(typeof window!=="undefined"?window:globalThis);
