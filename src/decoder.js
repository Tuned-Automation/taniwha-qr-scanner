export function createDecoder(){
  const supported = 'BarcodeDetector' in window;
  return {
    supported,
  };
}