package pendulum

import "math"

// ThetaDotsCompound 计算双复摆在当前 (theta1, p1, theta2, p2) 下的角速度
// y: [theta1, p1, theta2, p2]
func ThetaDotsCompound(y []float64, p *Params) (theta1dot, theta2dot float64) {
	if len(y) < 4 || len(p.L) < 2 || len(p.M) < 2 {
		return 0, 0
	}

	theta1 := y[0]
	p1 := y[1]
	theta2 := y[2]
	p2 := y[3]

	L1, L2 := p.L[0], p.L[1]
	m1, m2 := p.M[0], p.M[1]

	M := m1 + 3.0*m2
	delta := theta1 - theta2
	c := math.Cos(delta)
	Lr := L1 / L2
	den := 4.0*M - 9.0*m2*c*c

	theta1dot = 6.0 / (L1 * L1) * (2.0*p1 - 3.0*Lr*c*p2) / den
	theta2dot = 6.0 / (m2 * L2 * L2) * (2.0*p2*M - 3.0*m2/Lr*c*p1) / den

	return
}

// DerivCompound 计算双复摆的导数：dy/dt = f(y)
// y: [theta1, p1, theta2, p2]
// dst: 输出 [theta1dot, p1dot, theta2dot, p2dot]
func DerivCompound(y []float64, p *Params, dst []float64) {
	if len(y) < 4 || len(dst) < 4 || len(p.L) < 2 || len(p.M) < 2 {
		return
	}

	theta1 := y[0]
	theta2 := y[2]

	L1, L2 := p.L[0], p.L[1]
	m1, m2 := p.M[0], p.M[1]

	theta1dot, theta2dot := ThetaDotsCompound(y, p)

	g := p.G
	if g == 0 {
		g = 9.81
	}

	delta := theta1 - theta2
	s := math.Sin(delta)

	// term = (m2 * L1 * L2 / 2) * theta1dot * theta2dot * sin(delta)
	term := 0.5 * m2 * L1 * L2 * theta1dot * theta2dot * s

	// p1dot, p2dot（这里还没有加阻尼）
	p1dot := -term - (0.5*m1+m2)*g*L1*math.Sin(theta1)
	p2dot := term - 0.5*m2*g*L2*math.Sin(theta2)

	// 简单线性阻尼：p_dot -= c * theta_dot
	if p.Damping != 0 {
		c := p.Damping
		p1dot -= c * theta1dot
		p2dot -= c * theta2dot
	}

	dst[0] = theta1dot
	dst[1] = p1dot
	dst[2] = theta2dot
	dst[3] = p2dot
}

// InitialMomentaCompound 给定初始 (theta1, theta2, omega1, omega2)
// 按照文献中的关系计算共轭动量 p1, p2
//
// 公式来自 scipython 推导：
// p1 = (1/3 m1 L1^2 + m2 L1^2) * theta1dot + 1/2 m2 L1 L2 * theta2dot * cos(delta)
// p2 = 1/3 m2 L2^2 * theta2dot + 1/2 m2 L1 L2 * theta1dot * cos(delta)
func InitialMomentaCompound(theta1, theta2, omega1, omega2 float64, p *Params) (p1, p2 float64) {
	if len(p.L) < 2 || len(p.M) < 2 {
		return 0, 0
	}

	L1, L2 := p.L[0], p.L[1]
	m1, m2 := p.M[0], p.M[1]

	delta := theta1 - theta2
	c := math.Cos(delta)

	p1 = (m1*L1*L1/3.0+m2*L1*L1)*omega1 + 0.5*m2*L1*L2*omega2*c
	p2 = (m2*L2*L2/3.0)*omega2 + 0.5*m2*L1*L2*omega1*c

	return
}
