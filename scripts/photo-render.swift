import Foundation
import CoreImage
import ImageIO

guard CommandLine.arguments.count == 3 else {
    fputs("usage: photo-render input output.jpg\n", stderr)
    exit(1)
}
let input = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
guard let image = CIImage(contentsOf: input, options: [.applyOrientationProperty: true]),
      let colourSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
    fputs("Cannot decode source image\n", stderr)
    exit(1)
}
do {
    try CIContext(options: [.useSoftwareRenderer: false]).writeJPEGRepresentation(
        of: image, to: output, colorSpace: colourSpace,
        options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.96])
} catch {
    fputs("Cannot write rendered JPEG\n", stderr)
    exit(1)
}
