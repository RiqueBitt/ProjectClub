import struct
def rect(xmin,xmax,ymin,ymax):
    vals=[xmin,xmax,ymin,ymax]; nb=max(v.bit_length() for v in vals)+1
    bits=format(nb,'05b')+''.join(format(v & ((1<<nb)-1),'0%db'%nb) for v in vals)
    bits+= '0'*((8-len(bits)%8)%8)
    return bytes(int(bits[i:i+8],2) for i in range(0,len(bits),8))
def tag(code, body):
    if len(body) < 63: return struct.pack('<H',(code<<6)|len(body))+body
    return struct.pack('<HI',(code<<6)|63,len(body))+body
body = rect(0,15200,0,9600)+struct.pack('<HH',0x1800,1)
body += tag(69, struct.pack('<I',0)) + tag(12, b'\x00') + tag(1,b'') + tag(0,b'')
swf = b'FWS'+bytes([9])+struct.pack('<I',8+len(body))+body
open('template.swf','wb').write(swf); print(len(swf))
