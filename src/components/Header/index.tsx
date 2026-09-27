import logo from '@/assets/logo.svg'
import type { PropsWithChildren } from 'react'
import type React from 'react'
import { NavLink } from 'react-router-dom'

const Header: React.FC<PropsWithChildren> = ({ children }) => {
  return (
    <header className="container z-20 mx-auto w-full px-3 py-3 sm:px-10 sm:py-6">
      <div className="flex w-full flex-col items-center justify-between space-y-3 lg:flex-row lg:space-y-0">
        <NavLink
          className="flex items-center text-xl font-bold text-indigo-500 no-underline hover:no-underline sm:text-2xl lg:text-4xl"
          to="/"
        >
          <img src={logo} className="mr-2 h-10 w-10 sm:mr-3 sm:h-16 sm:w-16" alt="Qwerty Learner Logo" />
          <h1>Qwerty Learner</h1>
        </NavLink>
        <nav className="my-card on element flex w-full flex-wrap content-center items-center justify-center gap-2 rounded-xl bg-white p-2 transition-colors duration-300 dark:bg-gray-800 sm:w-auto sm:justify-end sm:gap-3 sm:p-4">
          {children}
        </nav>
      </div>
    </header>
  )
}

export default Header
