import sys,swf,struct
def build(src,n,dst,half=int(__import__("os").environ.get("HALF","40"))):
    ver,rect,fps,frames,tags=swf.read(src)
    out=[];fr=0
    for code,data in tags:
        if code==0: break
        if code==1:
            fr+=1
            if fr==n:
                out.append((12,b'\x07\x00'))  # DoAction: stop
                out.append((1,b''));break
            out.append((code,data));continue
        out.append((code,data))
    out.append((0,b''))
    swf.write(dst,ver,swf.pack_rect(-half*20,half*20,-half*20,half*20),fps,n,out)
if __name__=='__main__':
    build(sys.argv[1],int(sys.argv[2]),sys.argv[3])
