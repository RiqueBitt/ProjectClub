import zlib,struct
def read(path):
    d=open(path,'rb').read()
    sig=d[:3];ver=d[3];body=d[8:]
    if sig==b'CWS': body=zlib.decompress(body)
    nb=body[0]>>3; rl=(5+nb*4+7)//8
    rect=body[:rl]; fps,frames=struct.unpack('<HH',body[rl:rl+4])
    tags=[];p=rl+4
    while p<len(body):
        h=struct.unpack('<H',body[p:p+2])[0];code=h>>6;ln=h&63;p+=2
        if ln==63: ln=struct.unpack('<I',body[p:p+4])[0];p+=4
        tags.append((code,body[p:p+ln]));p+=ln
    return ver,rect,fps,frames,tags
def pack_rect(x0,x1,y0,y1):
    vals=[x0,x1,y0,y1];nb=max(abs(v) for v in vals).bit_length()+1
    bits=f'{nb:05b}'+''.join(format(v&((1<<nb)-1),f'0{nb}b') for v in vals)
    bits+='0'*(-len(bits)%8);return bytes(int(bits[i:i+8],2) for i in range(0,len(bits),8))
def tag(code,data):
    if len(data)<63: return struct.pack('<H',(code<<6)|len(data))+data
    return struct.pack('<H',(code<<6)|63)+struct.pack('<I',len(data))+data
def write(path,ver,rect,fps,frames,tags):
    body=rect+struct.pack('<HH',fps,frames)+b''.join(tag(c,d) for c,d in tags)
    open(path,'wb').write(b'FWS'+bytes([ver])+struct.pack('<I',len(body)+8)+body)
