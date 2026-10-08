// One photo's place names for photos:prepare (spec 7.2, ADR-0022). Reads the image's GPS with ImageIO and asks Apple's
// geocoder through MapKit; prints names only. The coordinates go to Apple's geocoding service and nowhere else: this
// process never prints, logs or writes them. --has-gps only says whether there are any, and asks nobody.
import CoreLocation
import Foundation
import ImageIO
import MapKit

func gpsLocation(_ url: URL) -> CLLocation? {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let gps = properties[kCGImagePropertyGPSDictionary] as? [CFString: Any],
          let latitude = gps[kCGImagePropertyGPSLatitude] as? Double,
          let longitude = gps[kCGImagePropertyGPSLongitude] as? Double else { return nil }
    let south = (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S"
    let west = (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W"
    return CLLocation(latitude: south ? -latitude : latitude, longitude: west ? -longitude : longitude)
}

let arguments = CommandLine.arguments
let checkOnly = arguments.count == 3 && arguments[1] == "--has-gps"
guard arguments.count == 2 || checkOnly else {
    fputs("usage: photo-place [--has-gps] image\n", stderr)
    exit(2)
}
guard let location = gpsLocation(URL(fileURLWithPath: arguments[arguments.count - 1])) else {
    print(checkOnly ? "false" : "null")
    exit(0)
}
if checkOnly {
    print("true")
    exit(0)
}
guard let request = MKReverseGeocodingRequest(location: location) else {
    fputs("Cannot make a geocoding request\n", stderr)
    exit(1)
}
request.preferredLocale = Locale(identifier: "en_AU")
do {
    let items = try await request.mapItems
    // The map item's placemark is the one MapKit object with all five names the city map needs; it carries a
    // deprecation note in the macOS 26 SDK, so swiftc prints one warning for this line
    guard let placemark = items.first?.placemark else {
        print("null")
        exit(0)
    }
    let names: [String: Any] = [
        "subLocality": placemark.subLocality ?? NSNull(),
        "locality": placemark.locality ?? NSNull(),
        "subAdministrativeArea": placemark.subAdministrativeArea ?? NSNull(),
        "administrativeArea": placemark.administrativeArea ?? NSNull(),
        "isoCountryCode": placemark.isoCountryCode ?? NSNull(),
    ]
    let data = try JSONSerialization.data(withJSONObject: names, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} catch {
    fputs("Geocoding failed\n", stderr)
    exit(1)
}
