import Foundation

let viewport = CGRect(x: 20, y: 40, width: 350, height: 700)
assert(!AldusSelectionPaging.isBottomEdge(CGPoint(x: 200, y: 50), viewport: viewport))
assert(!AldusSelectionPaging.isBottomEdge(CGPoint(x: 369, y: 400), viewport: viewport))
assert(AldusSelectionPaging.isBottomEdge(CGPoint(x: 200, y: 720), viewport: viewport))
assert(!AldusSelectionPaging.isBottomEdge(CGPoint(x: 10, y: 720), viewport: viewport))
assert(!AldusSelectionPaging.isBottomEdge(CGPoint(x: 200, y: 750), viewport: viewport))
assert(!AldusSelectionPaging.isBottomEdge(.zero, viewport: .zero))

assert(AldusSelectionPaging.nextOffset(current: 390, width: 390, contentWidth: 1170, rightToLeft: false) == 780)
assert(AldusSelectionPaging.nextOffset(current: 780, width: 390, contentWidth: 1170, rightToLeft: false) == nil)
assert(AldusSelectionPaging.nextOffset(current: 780, width: 390, contentWidth: 1170, rightToLeft: true) == 390)
assert(AldusSelectionPaging.nextOffset(current: 0, width: 390, contentWidth: 1170, rightToLeft: true) == nil)
assert(AldusSelectionPaging.nextOffset(current: 0, width: 0, contentWidth: 1170, rightToLeft: false) == nil)
assert(AldusSelectionPaging.nextOffset(current: .infinity, width: 390, contentWidth: 1170, rightToLeft: false) == nil)
assert(AldusSelectionPaging.nextOffset(current: -390, width: 390, contentWidth: 1170, rightToLeft: false) == nil)
print("Selection edge geometry passed")
