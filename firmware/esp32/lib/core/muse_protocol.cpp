#include "muse_protocol.h"

#include <cstring>

namespace bcihand {
namespace muse_protocol {

int decodeUnsigned12BitSamples(const uint8_t* bytes, int byteLength, int* out, int outCapacity) {
  int written = 0;
  int i = 0;
  while (i < byteLength && written < outCapacity) {
    if (i % 3 == 0) {
      if (i + 1 >= byteLength) break;
      out[written++] = (bytes[i] << 4) | (bytes[i + 1] >> 4);
      i += 1;
    } else {
      if (i + 1 >= byteLength) break;
      out[written++] = ((bytes[i] & 0xf) << 8) | bytes[i + 1];
      i += 2;
    }
  }
  return written;
}

void scaleEegSamplesUv(int* raw, double* outUv, int n) {
  for (int i = 0; i < n; i++) {
    outUv[i] = kEegScaleUv * (raw[i] - 0x800);
  }
}

void decodeAccelerometerSamples(const uint8_t* bytes, int byteLength, ImuTriplet outSamples[3]) {
  auto readInt16BE = [&](int offset) -> int16_t {
    return static_cast<int16_t>((bytes[offset] << 8) | bytes[offset + 1]);
  };
  int sampleIdx = 0;
  for (int ofs = 2; ofs <= 14 && ofs + 5 < byteLength; ofs += 6) {
    outSamples[sampleIdx].x = kAccelerometerScaleG * readInt16BE(ofs);
    outSamples[sampleIdx].y = kAccelerometerScaleG * readInt16BE(ofs + 2);
    outSamples[sampleIdx].z = kAccelerometerScaleG * readInt16BE(ofs + 4);
    sampleIdx++;
  }
}

int encodeControlCommand(const char* cmd, uint8_t* out, int outCapacity) {
  // Reference implementations build "X" + cmd + "\n" as text, then
  // overwrite byte[0] (the 'X') with (encoded length - 1) as a length
  // prefix — so the final wire format is [lengthByte, cmd..., '\n'] with
  // no 'X' anywhere. Verified against a live run of the actual reference
  // encodeCommand() (web/src/muse/protocol.ts): encodeControlCommand("p21")
  // must produce exactly {4, 'p','2','1', '\n'} = {4,112,50,49,10}.
  int cmdLen = static_cast<int>(std::strlen(cmd));
  int totalLen = cmdLen + 2;  // matches "X"+cmd+"\n"'s length
  if (totalLen > outCapacity) return 0;
  out[0] = static_cast<uint8_t>(totalLen - 1);
  std::memcpy(out + 1, cmd, cmdLen);
  out[totalLen - 1] = '\n';
  return totalLen;
}

}  // namespace muse_protocol
}  // namespace bcihand
