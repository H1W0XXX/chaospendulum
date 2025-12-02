package pendulum

import "math"

// TipPositions 返回两根杆末端的坐标 (x1, y1, x2, y2)
// 固定点在原点 (0,0)，theta 从竖直向下为 0，逆时针为正
func TipPositions(theta1, theta2 float64, p *Params) (x1, y1, x2, y2 float64) {
	if len(p.L) < 2 {
		return 0, 0, 0, 0
	}
	L1, L2 := p.L[0], p.L[1]

	x1 = L1 * math.Sin(theta1)
	y1 = -L1 * math.Cos(theta1)

	x2 = x1 + L2*math.Sin(theta2)
	y2 = y1 - L2*math.Cos(theta2)

	return
}
