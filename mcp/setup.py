from setuptools import setup

setup(
    name="folio-mcp",
    version="0.0.1",
    py_modules=["folio_mcp_server"],
    entry_points={
        "console_scripts": ["folio-mcp-server = folio_mcp_server:main"]
    },
)
