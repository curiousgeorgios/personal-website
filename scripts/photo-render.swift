import Foundation
import CoreImage
import ImageIO
import Darwin

guard CommandLine.arguments.count == 3 else {
    fputs("usage: photo-render input output.tiff\n", stderr)
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
    umask(0o077)
    try CIContext(options: [.useSoftwareRenderer: false]).writeTIFFRepresentation(
        of: image, to: output, format: .RGBA16, colorSpace: colourSpace)
} catch {
    fputs("Cannot write rendered TIFF\n", stderr)
    exit(1)
}
